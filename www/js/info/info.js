'use strict';

angular.module('emission.main.info', ['emission.plugin.logger'])

.controller('InfoCtrl', function($scope){
  $scope.openExternal = function (elem) {
    window.open(elem.href, "_system");
    return false;
  };
})
