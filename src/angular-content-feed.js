(function (angular) {
'use strict';

angular.module('mvd.contentFeed', ['ngSanitize'])
  .provider('contentConfig', function () {
    // Config Defaults
    var defaults = {
      // What content provider to use. Must be set before initializing content factory
      provider: null,
      // How many items to load per page
      pageSize: 10,
      // Used by directive during render chain
      // These are functions that take the current value and return it transformed
      // Can also pass in the string name of a factory or filter to use
      formatters: [],
      // Property names
      properties: {
        id: 'id',
        content: 'content'
      },
      // What cache provider to use. Can be function or factory. Default is usually fine
      cache: 'contentCache',
      // How many unread articles should be left before trying to lazy-load new content?
      // Set to false to disable lazy-loading
      // Note, if 'feed' is never called, lazy-loading will never run (to prevent trying to load 'next' article on a standalone page)
      unreadBuffer: 2
    }
    // User specified options
      , options = {}

    // Set options for this load
    this.setOptions = function (opts) {
      options = opts;
      return this;
    };

    // Shortcut method to set just provider
    this.setProvider = function (provider) {
      options.provider = provider;
      return this;
    };

    this.addFormatter = function (formatter) {
      options.formatters || (options.formatters = []);
      options.formatters.push(formatter);
      return this;
    }

    this.$get = ['$injector', '$log', function ($injector, $log) {
      var config = angular.extend({}, defaults, options);
      if (!config.provider) {
        throw('Must specify content provider before initializaing content');
      }

      if (angular.isString(config.provider)) {
        if (!$injector.has(config.provider)) {
          throw('Specified provider "' + config.provider + '" not registered with injector');
        }

        config.provider = $injector.get(config.provider)
      };

      if (angular.isString(config.cache)) {
        if (!$injector.has(config.cache)) {
          $log.warn('Specified cache "' + config.cache + '" not registered with injector, using noop');
          config.cache = $injector.get('noopCache');
        }

        config.cache = $injector.get(config.cache)
      } else if (!config.cache) {
        config.cache = $injector.get('noopCache');
      }

      if (config.formatters) {
        for (var i = 0, ii = config.formatters.length; i < ii; i++) {
          var f = config.formatters[i];
          if (!angular.isString(f)) {
            continue;
          }
          // First check by name, then for filter
          if ($injector.has(f)) {
            config.formatters[i] = $injector.get(f);
          } else if ($injector.has(f + 'Filter')) {
            config.formatters[i] = $injector.get(f + 'Filter');
          } else {
            $log.warn('unknown formatter', f,'replacing with identity');
            config.formatters[i] = angular.identity;
          }
        }
      };

      return config;
    }];

    return this;
  })
  // If requested cache doesn't exist, or is set to null
  // use this for convenience
  .factory('noopCache', function () {
    return {
      setRaw: angular.noop,
      getRaw: angular.noop,
      set: angular.noop,
      get: function (params, loadFn, success, error) {
        return loadFn(params, success, error);
      }
    }
  })
  .factory('contentCache', function ($q, $cacheFactory) {
    var cache = $cacheFactory('contentCache')
      , promises = {}
      , resolvePromises = function (hash, result, err) {
        if (!promises[hash] || !promises[hash].length) {
          return;
        }
        var ps = promises[hash].splice(0, Number.MAX_VALUE);
        for (var i = 0, ii = ps.length; i < ii; i++) {
          var p = ps[i];
          if (result) {
            p.resolve(result);
          } else {
            p.reject(err);
          }
        }
      }
      , _toHash = function (params) {
        if (angular.isString(params)) {
          return params;
        } else {
          return angular.toJson(params);
        }
      };

    return {
      setRaw: function (params, result) {
        var hash = _toHash(params);
        cache.put(hash, result);
        return this;
      },
      getRaw: function (params) {
        var hash = _toHash(params);
        var out = cache.get(hash);
        return out;
      },
      set: function (params, result, err) {
        var hash = _toHash(params);
        this.setRaw(hash, result);
        return this;
      },
      // Params to get, and loading fn to use if not in cache
      // loadingFn should take params as first parameter, then success/error callbacks
      get: function (params, loadFn, success, error) {
        var hash = _toHash(params)
          , result
          , promise = $q.defer();

        promise.promise.then(success, error);
        if (result = this.getRaw(hash)) {
          promise.resolve(result);
          return result;
        } else {
          if (!promises[hash]) {
            promises[hash] = [];
          };
          promises[hash].push(promise);
          result = loadFn(params,
            function(response) {
              resolvePromises(hash, response);
            },
            function (err) {
              resolvePromises(hash, null, err);
            }
          );
          this.set(hash, result);
          return result;
        }
      }
    };
  })
  .factory('content', function (contentConfig, $timeout) {
    var provider = contentConfig.provider
      , cache = contentConfig.cache
      , _current
      , _slice = [].slice
      // Various events other parts of the app can subscribe to
      , _listeners = {
        // load: [], // New content is loaded (not from cache) | args:
        // atEnd: [], // Current is last item in feed (if lazy loading, not called unless no more items returned) | args: lastItem
        // atStart: [], // Current is first item in feed | args: firstItem
        currentSet: [] // An item is set as current | args: newCurrent, previousCurrent
      }
      , _setDefaults = function (params) {
        var defs = {
          limit: contentConfig.pageSize
        };
        if (!params) {
          return defs;
        }
        return angular.extend(defs, params);
      }
      , _updateCurrent = function (item, force) {
        if (!force && (item === _current)) {
          return;
        };
        var last = _current;
        _current = item;
        _notifyListeners('currentSet', item, last);
      }
      , _notifyListeners = function (event/*, args... */) {
        var cbs = _listeners[event];
        if (!cbs || !cbs.length) {
          return;
        }
        var args = [].splice.call(arguments, 1);
        for (var i = 0, ii = cbs.length; i < ii; i++) {
          $timeout((function (cb) {
            return function () {
              cb.apply(null, args);
            };
          })(cbs[i]));
        }
      }
      , _loadingFeed = function () {
        if (!angular.isNumber(contentConfig.unreadBuffer)) {
          return;
        }
        methods.on('currentSet', function (current, last) {
          // check index, confirm this is later than last, and if within buffer, fire lazy load
        });
      }
      , _digestedFunc = function (fn) {
        if (!fn) {
          // Still pass through some fn so that digest happens
          fn = angular.noop;
        }
        return function () {
          var args = _slice.call(arguments, 0)
            , that = this;
          $timeout(function () {
            fn.apply(that, args);
          });
        };
      };

    var methods = {
      // Get a content item by id, with optional success/error callbacks
      get: function (id, success, error) {
        var result = cache.getRaw(id);
        if (result) {
          _updateCurrent(result, true);
          if (success) {
            _digestedFunc(success)(result);
          };
          return result;
        };

        var loadFn;
        if (provider.get.bind) {
          loadFn = provider.get.bind(provider);
        } else {
          loadFn = provider.get;
        }

        result = cache.get(
          id,
          loadFn,
          function (response) {
            _updateCurrent(result, true);
            _digestedFunc(success);
          },
          _digestedFunc(error)
        );
        return result;
      },
      // Get the current item
      // or optionally set the current item (pass null to clear it)
      current: function (item) {
        if (typeof(item) !== 'undefined') {
          _updateCurrent(item);
          return this;
        };
        return _current;
      },
      // Get a feed (array) of content items, based on filter params
      // Params are passed directly through to provider load function
      feed: function (params, success, error) {
        var params = _setDefaults(params)
          , result = cache.getRaw(params);
        if (result) {
          if (success) {
            _digestedFunc(success)(result);
          };
          return result;
        };
        _loadingFeed();
        return cache.get(params, provider.load.bind(provider), _digestedFunc(success), _digestedFunc(error));
      },
      on: function (event, fn) {
        if (!_listeners[event]) {
          // Warn about non-existent event
          _listeners[event] = [];
        };
        _listeners[event].push(fn);
        return this;
      }
    };

    return methods;
  })
  .directive('contentWrapper', function (content) {
    return {
      scope: true,
      link: function ($scope, $element, $attrs) {
        $scope.feed = content.feed();
      }
    }
  })
  .directive('contentElement', function (contentConfig) {
    return {
      scope: true,
      link: function ($scope, $element, $attrs) {
        var _formatContent = angular.identity;
        if (contentConfig.formatters.length) {
          _formatContent = function (content) {
            if (!content) {
              return content;
            };
            var pipeline = contentConfig.formatters;
            for (var i = 0, ii = pipeline.length; i < ii; i++) {
              var formatter = pipeline[i];
              content = formatter(content);
              if (typeof(content) === 'undefined') {
                break;
              };
            }
            return content;
          };
        };

        $scope.$watch($attrs.contentElement + '.' + contentConfig.properties.content, function (nv) {
          $scope.$formattedContent = _formatContent(nv);
        });
      }
    }
  })
})(angular);