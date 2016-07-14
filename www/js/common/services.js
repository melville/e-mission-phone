'use strict';

angular.module('emission.main.common.services', [])

.factory('CommonGraph', function($rootScope, $http) {
    var commonGraph = {};
    commonGraph.data = {};
    commonGraph.UPDATE_DONE = "COMMON_GRAPH_UPDATE_DONE";

    var db = window.cordova.plugins.BEMUserCache;
    var selKey = "common-trips";

    commonGraph.updateCurrent = function() {
      db.getDocument(selKey, function(entryList) {
        try{
            var cmGraph = JSON.parse(entryList);
        } catch(err) {
            window.Logger.log("Error "+err+" while parsing common trip data");
            // If there was an error in parsing the current common trips, and
            // there is no existing cached common trips, we create a blank
            // version so that other things don't crash
            if (angular.isUndefined(cmGraph)) {
                cmGraph = {
                    'user_id': 'unknown',
                    'common_trips': [],
                    'common_places': []
                }
            }
        }
        commonGraph.data.graph = cmGraph;
        postProcessData();
        toGeojson();
        $rootScope.$broadcast(commonGraph.UPDATE_DONE, {'from': 'broadcast', 'status': 'success'});
      }, function(error) {
        $rootScope.$broadcast(commonGraph.UPDATE_DONE, {'from': 'broadcast', 'status': 'error'});
      });
    };

    /*
     * Returns the common trip corresponding to the specified tripId
     */
    commonGraph.trip2Common = function(tripId) {
        return commonGraph.data.trip2CommonMap[tripId];
    };

    commonGraph.place2Common = function(placeId) {
        return commonGraph.data.place2CommonMap[placeId];
    };

    commonGraph.time_fns = {};

    commonGraph.time_fns.getMostFrequentHour = function(timeArray) {
      var binFn = function(localTime) {
        return localTime.hour;
      }
      var hourMap = binEntries(timeArray, binFn);
      var maxEntry = getKeyWithMaxVal(hourMap);
      if (angular.isDefined(maxEntry)) {
        return maxEntry[0];
      } else {
        return maxEntry;
      }
    };

    commonGraph.time_fns.getMostFrequentDuration = function(durationArray) {
      if (durationArray.length == 0) {
        return 0;
      };
      var minDur = durationArray.reduce(function(a, b) { return Math.min(a, b); });
      var maxDur = durationArray.reduce(function(a, b) { return Math.max(a, b); });
      var scale = 60;
      if (minDur > 60 * 60 || maxDur > 60 * 60) {
        scale = 60 * 60;
      }
      var binFn = function(duration) {
        return duration/scale;
      }
      var durationMap = binEntries(durationArray, binFn);
      var maxEntry = getKeyWithMaxVal(durationMap);
      if (angular.isDefined(maxEntry)) {
        return maxEntry[0] * scale;
      } else {
        return maxEntry;
      }
    };

    var binEntries = function(toBinArray, binFn) {
      var binnedMap = new Map();
      toBinArray.forEach(function(entry, index, array) {
        var key = binFn(entry);
        var currValue = binnedMap.get(key);
        if (angular.isDefined(currValue)) {
          binnedMap.set(key, currValue + 1);
        } else {
          binnedMap.set(key, 1);
        }
      });
      return binnedMap;
    }

    /*
     * Returns the number of trips mapped to the specified commonTripId
     */
    commonGraph.getCount = function(cTripId) {
        return commonGraph.data.cTripCountMap[cTripId];
    };

    /*
     * Returns the common trip for a (start, end) pair
     */
    commonGraph.getCommonTripForStartEnd = function(commonStartPlaceId, commonEndPlaceId) {
        var retMap = new Map();
        commonGraph.data.graph.common_trips.forEach(function(cTrip, index, array) {
          if (cTrip.start_place.$oid == commonStartPlaceId &&
              cTrip.end_place.$oid == commonEndPlaceId) {
              retMap.set(cTrip, cTrip.trips.length);
          }
        });
        var maxEntry = getKeyWithMaxVal(retMap);
        return maxEntry[0];
    };

    var getKeyWithMaxVal = function(kv_map) {
      var kv_array = mapEntries(kv_map);
      if (kv_array.length == 0) {
        return null;
      }
      var maxEntry = kv_array[0];
      kv_array.forEach(function(entry, index, array) {
        if (entry[1] > maxEntry[1]) {
          maxEntry = entry;
        }
      });
      return maxEntry;
    };

    var mapEntries = function(input_map) {
      var arr = [];
      for (var entry of input_map.entries()) {
        arr.push(entry);
      };
      return arr;
    };

    var postProcessData = function() {
        // Count the number of trips in each common trip. Also, create a map
        // from the trip list to the trip for efficient lookup
        commonGraph.data.cTripCountMap = {};
        commonGraph.data.trip2CommonMap = {};
        commonGraph.data.cTripId2ObjMap = {};
        commonGraph.data.graph.common_trips.forEach(function(cTrip, index, array) {
            commonGraph.data.cTripCountMap[cTrip._id.$oid] = cTrip.trips.length;
            commonGraph.data.cTripId2ObjMap[cTrip._id.$oid] = cTrip;
            getDisplayNameForTrip(cTrip);
            cTrip.trips.forEach(function(tripId,index,array) {
                commonGraph.data.trip2CommonMap[tripId.$oid] = cTrip;
            });
            cTrip.common_hour = commonGraph.time_fns.getMostFrequentHour(cTrip.start_times);
            cTrip.common_duration = commonGraph.time_fns.getMostFrequentDuration(cTrip.durations);
        });
        commonGraph.data.cPlaceCountMap = {};
        commonGraph.data.place2CommonMap = {};
        commonGraph.data.cPlaceId2ObjMap = {};
        commonGraph.data.graph.common_places.forEach(function(cPlace, index, array) {
            commonGraph.data.cPlaceCountMap[cPlace._id.$oid] = cPlace.places.length;
            commonGraph.data.cPlaceId2ObjMap[cPlace._id.$oid] = cPlace;
            if (angular.isDefined(cPlace.displayName)) {
              console.log("For place "+cPlace.id+", already have displayName "+cPlace.displayName);
            } else {
              console.log("Don't have display name for end place, going to query nominatim");
              getDisplayName(cPlace);
            }
            cPlace.places.forEach(function(placeId,index,array) {
                commonGraph.data.place2CommonMap[placeId.$oid] = cPlace;
            });
        });
        commonGraph.data.graph.common_places.forEach(function(cPlace, index, array) {
          cPlace.succ_places = cPlace.successors.map(function(succId, index, array) {
            // succId is currently an object
            return commonGraph.data.cPlaceId2ObjMap[succId._id.$oid];
          });
        });
    };

    var toGeojson = function() {
        var places = commonGraph.data.graph.common_places.map(function(place) {
            return {
                "type": "Feature",
                "id": place._id.$oid,
                "geometry": place.location,
                "properties": {
                    "displayName": place.displayName
                }
            };
        });
        // places.map($scope.getDisplayName);
        var trips = commonGraph.data.graph.common_trips.map(function(trip) {
            return {
                "type": "Feature",
                "id": trip._id.$oid,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [trip.start_loc.coordinates, trip.end_loc.coordinates]
                }
            };
        });
        commonGraph.data.geojson = {
          "type": "FeatureCollection",
          "features": places.concat(trips)
        };
    };
    var getDisplayNameForTrip = function(common_trip) {
      var responseListener0 = function(data) {
        var address = data["address"];
        var name = "";
        if (address["road"]) {
          name = address["road"];
        } else if (address["neighbourhood"]) {
          name = address["neighbourhood"];
        }
        if (address["city"]) {
          name = name + ", " + address["city"];
        } else if (address["town"]) {
          name = name + ", " + address["town"];
        } else if (address["county"]) {
          name = name + ", " + address["county"];
        }

        console.log("got response, setting display name to "+name);
        common_trip.start_displayName = name;
      };
      var responseListener1 = function(data) {
        var address = data["address"];
        var name = "";
        if (address["road"]) {
          name = address["road"];
        } else if (address["neighbourhood"]) {
          name = address["neighbourhood"];
        }
        if (address["city"]) {
          name = name + ", " + address["city"];
        } else if (address["town"]) {
          name = name + ", " + address["town"];
        } else if (address["county"]) {
          name = name + ", " + address["county"];
        }

        console.log("got response, setting display name to "+name);
        common_trip.end_displayName = name;
      };
      var url0 = "http://nominatim.openstreetmap.org/reverse?format=json&lat=" + common_trip.start_loc.coordinates[1]
      + "&lon=" + common_trip.start_loc.coordinates[0];
      console.log("About to make call "+url0);
      $http.get(url0).then(function(response) {
        console.log("while reading data from nominatim, status = "+response.status
          +" data = "+JSON.stringify(response.data));
        responseListener0(response.data);
      }, function(error) {
        console.log("while reading data from nominatim, error = "+error);
      });
      var url1 = "http://nominatim.openstreetmap.org/reverse?format=json&lat=" + common_trip.end_loc.coordinates[1]
      + "&lon=" + common_trip.end_loc.coordinates[0];
      console.log("About to make call "+url1);
      $http.get(url1).then(function(response) {
        console.log("while reading data from nominatim, status = "+response.status
          +" data = "+JSON.stringify(response.data));
        responseListener1(response.data);
      }, function(error) {
        console.log("while reading data from nominatim, error = "+error);
      });
    };
    var getDisplayName = function(common_place) {
      var responseListener = function(data) {
        var address = data["address"];
        var name = "";
        if (address["road"]) {
          name = address["road"];
        } else if (address["neighbourhood"]) {
          name = address["neighbourhood"];
        }
        if (address["city"]) {
          name = name + ", " + address["city"];
        } else if (address["town"]) {
          name = name + ", " + address["town"];
        } else if (address["county"]) {
          name = name + ", " + address["county"];
        }

        console.log("got response, setting display name to "+name);
        common_place.displayName = name;
      };

      var url = "http://nominatim.openstreetmap.org/reverse?format=json&lat=" + common_place.location.coordinates[1]
      + "&lon=" + common_place.location.coordinates[0];
      console.log("About to make call "+url);
      $http.get(url).then(function(response) {
        console.log("while reading data from nominatim, status = "+response.status
          +" data = "+JSON.stringify(response.data));
        responseListener(response.data);
      }, function(error) {
        console.log("while reading data from nominatim, error = "+error);
      });
    };

    return commonGraph;
});
