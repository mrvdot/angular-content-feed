/* global describe it module beforeEach */
describe('Angular Content Feed', function () {
  describe('Config', function () {
    var testProvider = {get: angular.noop};
    beforeEach(function () {
      module('mvd.contentFeed');

      module(function ($provide) {
        $provide.factory('testProvider', function () { 
          return testProvider;
        });
      })
    });

    it('should throw error when no provider is set', function () {
      expect(function () {
        inject(function(contentConfig) {

        });
      }).toThrow();
    });

    it('should not throw error when a provider has been set', function () {
      module(function (contentConfigProvider) {
        contentConfigProvider.setOptions({
          provider: 'testProvider'
        });
      });

      expect(function () {
        inject(function (contentConfig) {

        });
      }).not.toThrow();
    });

    it('should load provider from string name', function () {
      module(function (contentConfigProvider) {
        contentConfigProvider.setOptions({
          provider: 'testProvider'
        });
      });

      inject(function (contentConfig) {
        expect(contentConfig.provider).toBe(testProvider);
      });
    });

    it('should allow provider object to be passed in directly', function () {
      module(function (contentConfigProvider) {
        contentConfigProvider.setOptions({
          provider: testProvider
        });
      });

      inject(function (contentConfig) {
        expect(contentConfig.provider).toBe(testProvider);
      });
    });
  });

  describe('Factory', function () {
    var testProvider = jasmine.createSpyObj('testProvider', ['load', 'get'])
      , content;
    beforeEach(function () {
      module('mvd.contentFeed', function (contentConfigProvider) {
        contentConfigProvider.setProvider(testProvider);
      });

      inject(function (_content_) {
        content = _content_;
      });
    });

    it('should pass through calls to get and set result as current', function () {
      var result = {id: 123};
      testProvider.get.andReturn(result);
      var returned = content.get('arg1', angular.noop);
      expect(testProvider.get).toHaveBeenCalledWith('arg1', jasmine.any(Function), jasmine.any(Function));
      expect(result).toBe(returned);
      expect(content.current()).toBe(result);
    });
  });

  describe('Directives', function () {
    var testProvider = jasmine.createSpyObj('testProvider', ['load', 'get'])
      , content
      , element
      , formatter
      , tpl = [
        '<div content>',
        '  <div ng-repeat="element in feed" content-element="element">',
        '    <p>{{element.title}}</p>',
        '    <div ng-bind-html="$formattedContent"></div>',
        '  </div>',
        '</div>'
      ].join('\n');

    beforeEach(function () {
      module('mvd.contentFeed', function (contentConfigProvider, $provide) {
        contentConfigProvider.setProvider(testProvider);

        $provide.factory('myFormatter', function () {
          formatter = createSpy('myFormatter').and.callFake(angular.identity);
          return formatter;
        });

        contentConfigProvider.addFormatter('myFormatter');
      });

      inject(function (_content_, $compile, $rootScope) {
        content = _content_;
        element = $compile(tpl, $rootScope.$new());
      });

      it('should load feed on initialization', function () {
        var scope = element.scope();
        expect(testProvider.load).toHaveBeenCalled();
        expect(scope.feed).toBe(jasmine.any(Array));
      });

      it('should format content using formatters', function () {
        var scope = element.scope();
        scope.element.content = 'my new content';
        scope.$digest();
        expect(formatter).toHaveBeenCalledWith('my new content');
      });
    });
  })
});