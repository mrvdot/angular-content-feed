(function (angular) {
'use strict';

angular.module('mvd.contentFeed', ['ngSanitize'])
  .provider('contentConfig', function () {
    // Config Defaults
    var defaults = {
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
      }
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
  .factory('content', ['contentConfig', '$timeout', function (contentConfig, $timeout) {
    var provider = contentConfig.provider
      , _current
      , _slice = [].slice
      , _digestedFunc = function (fn) {
        if (!fn) {
          return undefined;
        };
        return function () {
          $timeout(fn);
        };
      };
    return {
      get: function (id, success, error) {
        var result = provider.get(id, _digestedFunc(success), _digestedFunc(error));
        _current = result;
        return result;
      },
      current: function () {
        return _current;
      },
      feed: function (pageSize, success, error) {
        return provider.load({
          limit: pageSize || contentConfig.pageSize
        }, _digestedFunc(success), _digestedFunc(error));
      }
    }
  }])
  .directive('content', ['content', function (content) {
    return {
      scope: true,
      link: function ($scope, $element, $attrs) {
        $scope.feed = content.feed();
      }
    }
  }])
  .directive('contentElement', ['contentConfig', function (contentConfig) {
    return {
      scope: true,
      link: function ($scope, $element, $attrs) {
        if (contentConfig.formatters.length) {
          var _formatContent = function (content) {
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

          $scope.$watch($attrs.contentElement + '.' + contentConfig.properties.content, function (nv) {
            $scope.$formattedContent = _formatContent(nv);
          });
        };
      }
    }
  }])
})(angular);