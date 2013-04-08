'use strict';

(function() {

  describe('Go Juju environment utilities', function() {
    var environments, Y;

    before(function(done) {
      Y = YUI(GlobalConfig).use(['juju-env-go'], function(Y) {
        environments = Y.namespace('juju.environments');
        done();
      });
    });

    it('provides a way to retrieve a relation key from endpoints', function() {
      var endpoints = {
        wordpress: {Name: 'website', Role: 'provider'},
        haproxy: {Name: 'reverseproxy', Role: 'requirer'}
      };
      var key = environments.createRelationKey(endpoints);
      assert.deepEqual('haproxy:reverseproxy wordpress:website', key);
    });

    it('provides a way to lowercase the keys of an object', function() {
      var obj = {Key1: 'value1', key2: 'value2', MyThirdKey: 'value3'},
          expected = {key1: 'value1', key2: 'value2', mythirdkey: 'value3'},
          result = environments.lowerObjectKeys(obj);
      assert.deepEqual(expected, result);
    });

    it('provides a way to convert object values to strings', function() {
      var obj = {key1: 42, key2: false, key3: null, key4: 'foo'},
          expected = {key1: '42', key2: 'false', key3: 'null', key4: 'foo'},
          result = environments.stringifyObjectValues(obj);
      assert.deepEqual(expected, result);
    });

  });

  describe('Go Juju JSON replacer', function() {
    var cleanUpJSON, Y;

    before(function(done) {
      Y = YUI(GlobalConfig).use(['juju-env-go'], function(Y) {
        cleanUpJSON = Y.namespace('juju.environments').cleanUpJSON;
        done();
      });
    });

    it('blacklists null values', function() {
      assert.isUndefined(cleanUpJSON('mykey', null));
    });

    it('returns other allowed values as they are', function() {
      var data = [
        'mystring', undefined, true, false, 42, ['list', 47.2, true]
      ];
      Y.each(data, function(item) {
        assert.strictEqual(item, cleanUpJSON('mykey', item));
      });
    });

  });

  describe('Go Juju environment', function() {
    var conn, endpointA, endpointB, env, juju, msg, utils, Y;

    before(function(done) {
      Y = YUI(GlobalConfig).use(['juju-env', 'juju-tests-utils'], function(Y) {
        juju = Y.namespace('juju');
        utils = Y.namespace('juju-tests.utils');
        done();
      });
    });

    beforeEach(function() {
      conn = new utils.SocketStub();
      env = juju.newEnvironment({
        conn: conn, user: 'user', password: 'password'
      }, 'go');
      env.connect();
    });

    afterEach(function()  {
      env.destroy();
    });

    it('sends the correct login message', function() {
      env.login();
      var last_message = conn.last_message();
      var expected = {
        Type: 'Admin',
        Request: 'Login',
        RequestId: 1,
        Params: {AuthTag: 'user', Password: 'password'}
      };
      assert.deepEqual(expected, last_message);
    });

    it('resets the user and password if they are not valid', function() {
      env.login();
      // Assume login to be the first request.
      conn.msg({RequestId: 1, Error: 'Invalid user or password'});
      assert.isNull(env.getCredentials());
      assert.isTrue(env.failedAuthentication);
    });

    it('fires a login event on successful login', function() {
      var loginFired = false;
      var result;
      env.on('login', function(evt) {
        loginFired = true;
        result = evt.data.result;
      });
      env.login();
      // Assume login to be the first request.
      conn.msg({RequestId: 1, Response: {}});
      assert.isTrue(loginFired);
      assert.isTrue(result);
    });

    it('fires a login event on failed login', function() {
      var loginFired = false;
      var result;
      env.on('login', function(evt) {
        loginFired = true;
        result = evt.data.result;
      });
      env.login();
      // Assume login to be the first request.
      conn.msg({RequestId: 1, Error: 'Invalid user or password'});
      assert.isTrue(loginFired);
      assert.isFalse(result);
    });

    it('avoids sending login requests without credentials', function() {
      env.setCredentials(null);
      env.login();
      assert.equal(0, conn.messages.length);
    });

    it('calls environmentInfo and watchAll ofter login', function() {
      env.login();
      // Assume login to be the first request.
      conn.msg({RequestId: 1, Response: {}});
      var environmentInfoMessage = conn.last_message(2);
      // EnvironmentInfo is the second request.
      var environmentInfoExpected = {
        Type: 'Client',
        Request: 'EnvironmentInfo',
        RequestId: 2,
        Params: {}
      };
      assert.deepEqual(environmentInfoExpected, environmentInfoMessage);
      var watchAllMessage = conn.last_message();
      // EnvironmentInfo is the second request.
      var watchAllExpected = {
        Type: 'Client',
        Request: 'WatchAll',
        RequestId: 3,
        Params: {}
      };
      assert.deepEqual(watchAllExpected, watchAllMessage);
    });

    it('sends the correct request for environment info', function() {
      env.environmentInfo();
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'EnvironmentInfo',
        RequestId: 1,
        Params: {}
      };
      assert.deepEqual(expected, last_message);
    });

    it('warns on environment info errors', function() {
      env.environmentInfo();
      // Mock "console.warn" so that it is possible to collect warnings.
      var original = console.warn;
      var warning = null;
      console.warn = function(msg) {
        warning = msg;
      };
      // Assume environmentInfo to be the first request.
      conn.msg({RequestId: 1, Error: 'Error retrieving env info.'});
      assert.include(warning, 'Error');
      // Restore the original "console.warn".
      console.warn = original;
    });

    it('stores environment info into env attributes', function() {
      env.environmentInfo();
      // Assume environmentInfo to be the first request.
      conn.msg({
        RequestId: 1,
        Response: {
          DefaultSeries: 'precise',
          'ProviderType': 'ec2',
          'Name': 'envname'
        }
      });
      assert.equal('precise', env.get('defaultSeries'));
      assert.equal('ec2', env.get('providerType'));
      assert.equal('envname', env.get('environmentName'));
    });

    it('sends the correct expose message', function() {
      env.expose('apache');
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'ServiceExpose',
        RequestId: 1,
        Params: {ServiceName: 'apache'}
      };
      assert.deepEqual(expected, last_message);
    });

    it('successfully exposes a service', function() {
      var service_name;
      env.expose('mysql', function(data) {
        service_name = data.service_name;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Response: {}
      });
      assert.equal(service_name, 'mysql');
    });

    it('handles failed service expose', function() {
      var service_name;
      var err;
      env.expose('mysql', function(data) {
        service_name = data.service_name;
        err = data.err;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Error: 'service \"mysql\" not found'
      });
      assert.equal(service_name, 'mysql');
      assert.equal(err, 'service "mysql" not found');
    });

    it('sends the correct unexpose message', function() {
      env.unexpose('apache');
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'ServiceUnexpose',
        RequestId: 1,
        Params: {ServiceName: 'apache'}
      };
      assert.deepEqual(expected, last_message);
    });

    it('successfully unexposes a service', function() {
      var err;
      var service_name;
      env.unexpose('mysql', function(data) {
        err = data.err;
        service_name = data.service_name;
      });
      // Mimic response, assuming ServiceUnexpose to be the first request.
      conn.msg({
        RequestId: 1,
        Response: {}
      });
      assert.isUndefined(err);
      assert.equal(service_name, 'mysql');
    });

    it('handles failed service unexpose', function() {
      var err;
      var service_name;
      env.unexpose('mysql', function(data) {
        err = data.err;
        service_name = data.service_name;
      });
      // Mimic response, assuming ServiceUnexpose to be the first request.
      conn.msg({
        RequestId: 1,
        Error: 'service \"mysql\" not found'
      });
      assert.equal(err, 'service "mysql" not found');
      assert.equal(service_name, 'mysql');
    });

    it('successfully deploys a service', function() {
      env.deploy('precise/mysql');
      msg = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'ServiceDeploy',
        Params: {
          Config: {},
          CharmUrl: 'precise/mysql'
        },
        RequestId: 1
      };
      assert.deepEqual(expected, msg);
    });

    it('successfully deploys a service with a config object', function() {
      var config = {debug: true, logo: 'example.com/mylogo.png'};
      var expected = {
        Type: 'Client',
        Request: 'ServiceDeploy',
        Params: {
          // Configuration values are sent as strings.
          Config: {debug: 'true', logo: 'example.com/mylogo.png'},
          CharmUrl: 'precise/mediawiki'
        },
        RequestId: 1
      };
      env.deploy('precise/mediawiki', null, config);
      msg = conn.last_message();
      assert.deepEqual(expected, msg);
    });

    it('successfully deploys a service with a config file', function() {
      /*jshint multistr:true */
      var config_raw = 'tuning-level: \nexpert-mojo';
      /*jshint multistr:false */
      var expected = {
        Type: 'Client',
        Request: 'ServiceDeploy',
        Params: {
          Config: {},
          ConfigYAML: config_raw,
          CharmUrl: 'precise/mysql'
        },
        RequestId: 1
      };
      env.deploy('precise/mysql', null, null, config_raw);
      msg = conn.last_message();
      assert.deepEqual(expected, msg);
    });

    it('successfully deploys a service storing charm data', function() {
      var charm_url;
      var err;
      var service_name;
      env.deploy('precise/mysql', 'mysql', null, null, null, function(data) {
        charm_url = data.charm_url;
        err = data.err;
        service_name = data.service_name;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Response: {}
      });
      assert.equal(charm_url, 'precise/mysql');
      assert.isUndefined(err);
      assert.equal(service_name, 'mysql');
    });

    it('handles failed service deploy', function() {
      var err;
      env.deploy('precise/mysql', 'mysql', null, null, null, function(data) {
        err = data.err;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Error: 'service "mysql" not found'
      });
      assert.equal(err, 'service "mysql" not found');
    });

    it('sends the correct get_annotations message', function() {
      env.get_annotations('apache', 'service');
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'GetAnnotations',
        RequestId: 1,
        Params: {Tag: 'service-apache'}
      };
      assert.deepEqual(expected, last_message);
    });

    it('sends the correct update_annotations message', function() {
      env.update_annotations('apache', 'service', {'mykey': 'myvalue'});
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'SetAnnotations',
        RequestId: 1,
        Params: {
          Tag: 'service-apache',
          Pairs: {
            mykey: 'myvalue'
          }
        }
      };
      assert.deepEqual(expected, last_message);
    });

    it('correctly sends all the annotation values as strings', function() {
      var annotations = {mynumber: 42, mybool: true, mystring: 'string'},
          expected = {mynumber: '42', mybool: 'true', mystring: 'string'};
      env.update_annotations('apache', 'service', annotations);
      var pairs = conn.last_message().Params.Pairs;
      assert.deepEqual(expected, pairs);
    });

    it('sends correct multiple update_annotations messages', function() {
      env.update_annotations('apache', 'service', {
        'key1': 'value1',
        'key2': 'value2'
      });
      var expected = [
        {
          Type: 'Client',
          Request: 'SetAnnotations',
          RequestId: 1,
          Params: {
            Tag: 'service-apache',
            Pairs: {
              key1: 'value1',
              key2: 'value2'
            }
          }
        }
      ];
      assert.deepEqual(expected, conn.messages);
    });

    it('sends the correct remove_annotations message', function() {
      env.remove_annotations('apache', 'service', ['key1']);
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'SetAnnotations',
        RequestId: 1,
        Params: {
          Tag: 'service-apache',
          Pairs: {
            key1: ''
          }
        }
      };
      assert.deepEqual(expected, last_message);
    });

    it('sends the correct remove_annotations message', function() {
      env.remove_annotations('apache', 'service', ['key1', 'key2']);
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'SetAnnotations',
        RequestId: 1,
        Params: {
          Tag: 'service-apache',
          Pairs: {
            key1: '',
            key2: ''
          }
        }
      };
      assert.deepEqual(expected, last_message);
    });

    it('successfully retrieves annotations', function() {
      var annotations;
      var expected = {
        'key1': 'value1',
        'key2': 'value2'
      };
      env.get_annotations('mysql', 'service', function(data) {
        annotations = data.results;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Response: {
          Annotations: expected
        }
      });
      assert.deepEqual(expected, annotations);
    });

    it('successfully sets annotation', function() {
      var err;
      env.update_annotations('mysql', 'service', {'mykey': 'myvalue'},
          function(data) {
            err = data.err;
          });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Response: {}
      });
      assert.isUndefined(err);
    });

    it('successfully sets annotations', function() {
      var err;
      env.update_annotations('mysql', 'service', {
        'key1': 'value1',
        'key2': 'value2'
      }, function(data) {
        err = data.err;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Response: {}
      });
      assert.isUndefined(err);
    });

    it('successfully removes annotations', function() {
      var err;
      env.remove_annotations('mysql', 'service', ['key1', 'key2'],
          function(data) {
            err = data.err;
          });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Response: {}
      });
      assert.isUndefined(err);
    });

    it('correctly handles errors from getting annotations', function() {
      var err;
      env.get_annotations('haproxy', 'service', function(data) {
        err = data.err;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Error: 'This is an error.'
      });
      assert.equal('This is an error.', err);
    });

    it('correctly handles errors from setting annotations', function() {
      var err;
      env.update_annotations('haproxy', 'service', {
        'key': 'value'
      }, function(data) {
        err = data.err;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Error: 'This is an error.'
      });
      assert.equal('This is an error.', err);
    });

    it('correctly handles errors from removing annotations', function() {
      var err;
      env.remove_annotations('haproxy', 'service', ['key1', 'key2'],
          function(data) {
            err = data.err;
          });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Error: 'This is an error.'
      });
      assert.equal('This is an error.', err);
    });

    it('sends the correct get_service message', function() {
      env.get_service('mysql');
      var last_message = conn.last_message();
      var expected = {
        Request: 'ServiceGet',
        Type: 'Client',
        RequestId: 1,
        Params: {ServiceName: 'mysql'}
      };
      assert.deepEqual(expected, last_message);
    });

    it('successfully gets service configuration', function() {
      var service_name;
      var result;
      var expected = {
        Service: 'mysql',
        Charm: 'mysql',
        Settings: {
          'binlog-format': {
            description: 'If binlogging is enabled, etc, etc","type":"string',
            value: null
          }
        }
      };
      env.get_service('mysql', function(data) {
        service_name = data.service_name;
        result = data.result;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Response: expected
      });
      assert.equal(service_name, 'mysql');
      assert.deepEqual(expected, result);
    });

    it('handles failed get service', function() {
      var service_name;
      var err;
      env.get_service('yoursql', function(data) {
        service_name = data.service_name;
        err = data.err;
      });
      // Mimic response.
      conn.msg({
        RequestId: 1,
        Error: 'service \"yoursql\" not found'
      });
      assert.equal(service_name, 'yoursql');
      assert.equal(err, 'service "yoursql" not found');
    });

    it('can set a service config', function() {
      env.set_config('mysql', {'cfg-key': 'cfg-val'});
      msg = conn.last_message();
      var expected = {
        Type: 'Client',
        Params: {
          ServiceName: 'mysql',
          Config: {
            'cfg-key': 'cfg-val'
          }
        },
        Request: 'ServiceSet',
        RequestId: msg.RequestId
      };
      assert.deepEqual(expected, msg);
    });

    it('can set a service config from a file', function() {
      /*jshint multistr:true */
      var data = 'tuning-level: \nexpert-mojo';
      /*jshint multistr:false */
      env.set_config('mysql', null, data);
      msg = conn.last_message();
      var expected = {
        RequestId: msg.RequestId,
        Type: 'Client',
        Request: 'ServiceSetYAML',
        Params: {
          ServiceName: 'mysql',
          ConfigYAML: data
        }
      };
      assert.deepEqual(expected, msg);
    });

    it('handles failed set config', function() {
      var err, service_name;
      env.set_config('yoursql', {}, null, function(evt) {
        err = evt.err;
        service_name = evt.service_name;
      });
      conn.msg({
        RequestId: msg.RequestId,
        Error: 'service "yoursql" not found'
      });
      assert.equal(err, 'service "yoursql" not found');
      assert.equal(service_name, 'yoursql');
    });

    it('sends the correct AddRelation message', function() {
      endpointA = ['haproxy', {name: 'reverseproxy'}];
      endpointB = ['wordpress', {name: 'website'}];
      env.add_relation(endpointA, endpointB);
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'AddRelation',
        Params: {
          Endpoints: ['haproxy:reverseproxy', 'wordpress:website']
        },
        RequestId: 1
      };
      assert.deepEqual(expected, last_message);
    });

    it('successfully adds a relation', function() {
      var endpoints, relationId, result;
      var jujuEndpoints = {};
      endpointA = ['haproxy', {name: 'reverseproxy'}];
      endpointB = ['wordpress', {name: 'website'}];
      env.add_relation(endpointA, endpointB, function(ev) {
        result = ev.result;
      });
      msg = conn.last_message();
      jujuEndpoints.haproxy = {
        Name: 'reverseproxy',
        Interface: 'http',
        Scope: 'global',
        Role: 'requirer'
      };
      jujuEndpoints.wordpress = {
        Name: 'website',
        Interface: 'http',
        Scope: 'global',
        Role: 'provider'
      };
      conn.msg({
        RequestId: msg.RequestId,
        Response: {
          Endpoints: jujuEndpoints
        }
      });
      assert.equal(result.id, 'haproxy:reverseproxy wordpress:website');
      assert.equal(result['interface'], 'http');
      assert.equal(result.scope, 'global');
      endpoints = result.endpoints;
      assert.deepEqual(endpoints[0], {'haproxy': {'name': 'reverseproxy'}});
      assert.deepEqual(endpoints[1], {'wordpress': {'name': 'website'}});
    });

    it('handles failed relation adding', function() {
      var evt;
      endpointA = ['haproxy', {name: 'reverseproxy'}];
      endpointB = ['wordpress', {name: 'website'}];
      env.add_relation(endpointA, endpointB, function(ev) {
        evt = ev;
      });
      msg = conn.last_message();
      conn.msg({
        RequestId: msg.RequestId,
        Error: 'cannot add relation'
      });
      assert.equal(evt.err, 'cannot add relation');
      assert.equal(evt.endpoint_a, 'haproxy:reverseproxy');
      assert.equal(evt.endpoint_b, 'wordpress:website');
    });

    it('sends the correct DestroyRelation message', function() {
      endpointA = ['mysql', {name: 'database'}];
      endpointB = ['wordpress', {name: 'website'}];
      env.remove_relation(endpointA, endpointB);
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'DestroyRelation',
        Params: {
          Endpoints: [
            'mysql:database',
            'wordpress:website'
          ]
        },
        RequestId: 1
      };
      assert.deepEqual(expected, last_message);
    });

    it('successfully removes a relation', function() {
      var endpoint_a, endpoint_b;
      endpointA = ['mysql', {name: 'database'}];
      endpointB = ['wordpress', {name: 'website'}];
      env.remove_relation(endpointA, endpointB, function(ev) {
        endpoint_a = ev.endpoint_a;
        endpoint_b = ev.endpoint_b;
      });
      msg = conn.last_message();
      conn.msg({
        RequestId: msg.RequestId,
        Response: {}
      });
      assert.equal(endpoint_a, 'mysql:database');
      assert.equal(endpoint_b, 'wordpress:website');
    });

    it('handles failed attempt to remove a relation', function() {
      var endpoint_a, endpoint_b, err;
      endpointA = ['yoursql', {name: 'database'}];
      endpointB = ['wordpress', {name: 'website'}];
      env.remove_relation(endpointA, endpointB, function(ev) {
        endpoint_a = ev.endpoint_a;
        endpoint_b = ev.endpoint_b;
        err = ev.err;
      });
      msg = conn.last_message();
      conn.msg({
        RequestId: msg.RequestId,
        Error: 'service "yoursql" not found'
      });
      assert.equal(endpoint_a, 'yoursql:database');
      assert.equal(endpoint_b, 'wordpress:website');
      assert.equal(err, 'service "yoursql" not found');
    });

    it('sends the correct CharmInfo message', function() {
      env.get_charm('cs:precise/wordpress-10');
      var last_message = conn.last_message();
      var expected = {
        Type: 'Client',
        Request: 'CharmInfo',
        Params: {CharmURL: 'cs:precise/wordpress-10'},
        RequestId: 1
      };
      assert.deepEqual(expected, last_message);
    });

    it('successfully retrieves information about a charm', function(done) {
      // Define a response example.
      var response = {
        Config: {
          Options: {
            debug: {
              Default: 'no',
              Description: 'Setting this option to "yes" will ...',
              Title: '',
              Type: 'string'
            },
            engine: {
              Default: 'nginx',
              Description: 'Two web server engines are supported...',
              Title: '',
              Type: 'string'
            }
          }
        },
        Meta: {
          Categories: null,
          Description: 'This will install and setup WordPress...',
          Format: 1,
          Name: 'wordpress',
          OldRevision: 0,
          Peers: {
            loadbalancer: {
              Interface: 'reversenginx',
              Limit: 1,
              Optional: false,
              Scope: 'global'
            }
          },
          Provides: {
            website: {
              Interface: 'http',
              Limit: 0,
              Optional: false,
              Scope: 'global'
            }
          },
          Requires: {
            cache: {
              Interface: 'memcache',
              Limit: 1,
              Optional: false,
              Scope: 'global'
            },
            db: {
              Interface: 'mysql',
              Limit: 1,
              Optional: false,
              Scope: 'global'
            }
          },
          Subordinate: false,
          Summary: 'WordPress is a full featured web blogging tool...'
        },
        Revision: 10,
        URL: 'cs:precise/wordpress-10'
      };
      // Define expected options.
      var options = response.Config.Options;
      var expectedOptions = {
        debug: {
          'default': options.debug.Default,
          description: options.debug.Description,
          type: options.debug.Type,
          title: options.debug.Title
        },
        engine: {
          'default': options.engine.Default,
          description: options.engine.Description,
          type: options.engine.Type,
          title: options.engine.Title
        }
      };
      // Define expected peers.
      var meta = response.Meta;
      var peer = meta.Peers.loadbalancer;
      var expectedPeers = {
        loadbalancer: {
          'interface': peer.Interface,
          limit: peer.Limit,
          optional: peer.Optional,
          scope: peer.Scope
        }
      };
      // Define expected provides.
      var provide = meta.Provides.website;
      var expectedProvides = {
        website: {
          'interface': provide.Interface,
          limit: provide.Limit,
          optional: provide.Optional,
          scope: provide.Scope
        }
      };
      // Define expected requires.
      var require1 = meta.Requires.cache;
      var require2 = meta.Requires.db;
      var expectedRequires = {
        cache: {
          'interface': require1.Interface,
          limit: require1.Limit,
          optional: require1.Optional,
          scope: require1.Scope
        },
        db: {
          'interface': require2.Interface,
          limit: require2.Limit,
          optional: require2.Optional,
          scope: require2.Scope
        }
      };
      env.get_charm('cs:precise/wordpress-10', function(data) {
        var err = data.err,
            result = data.result;
        // Ensure the result is correctly generated.
        assert.isUndefined(err);
        assert.deepEqual({options: expectedOptions}, result.config);
        assert.deepEqual(expectedPeers, result.peers);
        assert.deepEqual(expectedProvides, result.provides);
        assert.deepEqual(expectedRequires, result.requires);
        assert.equal(response.URL, result.url);
        // The result is enriched with additional info returned by juju-core.
        assert.equal(response.Revision, result.revision);
        assert.equal(meta.Description, result.description);
        assert.equal(meta.Format, result.format);
        assert.equal(meta.Name, result.name);
        assert.equal(meta.Subordinate, result.subordinate);
        assert.equal(meta.Summary, result.summary);
        done();
      });
      // Mimic response, assuming CharmInfo to be the first request.
      conn.msg({
        RequestId: 1,
        Response: response
      });
    });

    it('handles failed attempt to retrieve charm info', function(done) {
      env.get_charm('cs:precise/wordpress-10', function(data) {
        var err = data.err,
            result = data.result;
        assert.equal('charm not found', err);
        assert.isUndefined(result);
        done();
      });
      // Mimic response, assuming CharmInfo to be the first request.
      conn.msg({
        RequestId: 1,
        Error: 'charm not found'
      });
    });

    it('provides for a missing Params', function() {
      // If no "Params" are provided in an RPC call an empty one is added.
      var op = {};
      env._send_rpc(op);
      assert.deepEqual(op.Params, {});
    });

    it('can watch all changes', function() {
      env._watchAll();
      msg = conn.last_message();
      assert.equal(msg.Type, 'Client');
      assert.equal(msg.Request, 'WatchAll');
    });

    it('can retrieve the next set of environment changes', function() {
      // This is normally set by _watchAll, we'll fake it here.
      env._allWatcherId = 42;
      env._next();
      msg = conn.last_message();
      assert.equal(msg.Type, 'AllWatcher');
      assert.equal(msg.Request, 'Next');
      assert.isTrue('Id' in msg);
      // This response is in fact to the sent _next request.
      assert.equal(msg.Id, env._allWatcherId);
    });

    it('fires "_rpc_response" message after an RPC response', function(done) {
      // We don't want the real response, we just want to be sure the event is
      // fired.
      env.detach('_rpc_response');
      env.on('_rpc_response', function(data) {
        done();
      });
      // Calling this sets up the callback.
      env._next();
      env._txn_callbacks[env._counter].call(env, {});
      // The only test assertion is that done (above) is called.
    });

    it('fires "delta" when handling an RPC response', function(done) {
      env.detach('delta');
      var callbackData = {Response: {Deltas: [['service', 'deploy', {}]]}};
      env.on('delta', function(evt) {
        console.log(evt.data.result);
        done();
      });
      env._handleRpcResponse(callbackData);
    });

    it('translates the type of each change in the delta', function(done) {
      env.detach('delta');
      var callbackData = {Response: {Deltas: [['service', 'deploy', {}]]}};
      env.on('delta', function(evt) {
        var change = evt.data.result[0];
        assert.deepEqual(['serviceInfo', 'deploy', {}], change);
        done();
      });
      env._handleRpcResponse(callbackData);
    });

    it('the _rpc_response subscription can not have args', function() {
      var subscribers = env.getEvent('_rpc_response')._subscribers;
      // This test assumes that there is only one subscriber.  If we ever have
      // any more we will need to update this test.
      assert.equal(subscribers.length, 1);
      assert.equal(subscribers[0].args, null);
    });

  });

})();
