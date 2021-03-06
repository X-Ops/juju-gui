/*
This file is part of the Juju GUI, which lets users view and manage Juju
environments within a graphical interface (https://github.com/juju/juju-gui).
Copyright (C) 2016 Canonical Ltd.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License version 3, as published by
the Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranties of MERCHANTABILITY,
SATISFACTORY QUALITY, or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero
General Public License for more details.

You should have received a copy of the GNU Affero General Public License along
with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

describe('Controller API', function() {
  var cleanups, conn, controllerAPI, juju, utils, Y;

  before(function(done) {
    Y = YUI(GlobalConfig).use([
      'juju-controller-api',
      'juju-tests-utils'
    ], function(Y) {
      juju = Y.namespace('juju');
      utils = Y.namespace('juju-tests.utils');
      done();
    });
  });

  beforeEach(function() {
    conn = new utils.SocketStub();
    controllerAPI = new juju.ControllerAPI({
      conn: conn, user: 'user', password: 'password'
    });
    controllerAPI.connect();
    controllerAPI.set('facades', {
      AllModelWatcher: [2],
      Bundle: [1],
      Cloud: [1],
      Controller: [3],
      MigrationTarget: [1],
      ModelManager: [2],
      Pinger: [1],
      UserManager: [1]
    });
    controllerAPI.userIsAuthenticated = true;
    this._cleanups.push(controllerAPI.close.bind(controllerAPI));
    cleanups = [];
  });

  afterEach(function()  {
    cleanups.forEach(function(action) {action();});
    // We need to clear any credentials stored in sessionStorage.
    controllerAPI.setCredentials(null);
    if (controllerAPI && controllerAPI.destroy) {controllerAPI.destroy();}
    if (conn && conn.destroy) {conn.destroy();}
  });

  var noopHandleLogin = function() {
    var oldHandleLogin = Y.juju.ControllerAPI.handleLogin;
    Y.juju.ControllerAPI.handleLogin = function() {};
    cleanups.push(function() {
      Y.juju.ControllerAPI.handleLogin = oldHandleLogin;
    });
  };

  describe('findFacadeVersion', function() {
    beforeEach(function() {
      controllerAPI.set('facades', {'Test': [0, 1]});
    });

    afterEach(function() {});

    it('returns the version if the version is supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('Test', 0), 0);
      assert.strictEqual(controllerAPI.findFacadeVersion('Test', 1), 1);
    });

    it('returns the last version if the facade is supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('Test'), 1);
    });

    it('returns null if a specific version is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('Test', 2), null);
    });

    it('returns null if a default version is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('ChangeSet', 1), null);
    });

    it('returns null if a facade is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('BadWolf'), null);
    });

    it('returns null if a facade version is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('BadWolf', 42), null);
    });
  });

  describe('close', () => {
    it('stops the pinger', function(done) {
      const originalClearInterval = clearInterval;
      clearInterval = sinon.stub();
      this._cleanups.push(() => {
        clearInterval = originalClearInterval;
      });
      controllerAPI._pinger = 'I am the pinger';
      controllerAPI.close(() => {
        assert.strictEqual(clearInterval.calledOnce, true);
        const pinger = clearInterval.getCall(0).args[0];
        assert.strictEqual(pinger, 'I am the pinger');
        assert.strictEqual(controllerAPI._pinger, null);
        done();
      });
    });

    it('resets attributes', done => {
      controllerAPI.setConnectedAttr('controllerAccess', 'test');
      controllerAPI.close(() => {
        assert.strictEqual(controllerAPI.get('controllerAccess'), '');
        done();
      });
    });

    it('properly disconnects the user', done => {
      controllerAPI.userIsAuthenticated = true;
      controllerAPI.close(() => {
        assert.strictEqual(controllerAPI.userIsAuthenticated, false);
        done();
      });
    });
  });

  describe('login', function() {

    beforeEach(function() {
      controllerAPI.userIsAuthenticated = false;
    });

    it('sends the correct login message', function() {
      noopHandleLogin();
      controllerAPI.login();
      const lastMessage = conn.last_message();
      const expected = {
        type: 'Admin',
        request: 'Login',
        'request-id': 1,
        params: {'auth-tag': 'user-user@local', credentials: 'password'},
        version: 3
      };
      assert.deepEqual(expected, lastMessage);
    });

    it('sends the correct login message for external users', () => {
      noopHandleLogin();
      controllerAPI.setCredentials({user: 'who@external', password: 'pswd'});
      controllerAPI.login();
      const lastMessage = conn.last_message();
      const expected = {
        type: 'Admin',
        request: 'Login',
        'request-id': 1,
        params: {'auth-tag': 'user-who@external', credentials: 'pswd'},
        version: 3
      };
      assert.deepEqual(expected, lastMessage);
    });

    it('resets the user and password if they are not valid', function() {
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({'request-id': 1, error: 'Invalid user or password'});
      assert.deepEqual(
        controllerAPI.getCredentials(),
        {user: '', password: '', macaroons: null});
      assert.isTrue(controllerAPI.failedAuthentication);
    });

    it('fires a login event on successful login', function() {
      let fired = false;
      let err;
      controllerAPI.on('login', evt => {
        fired = true;
        err = evt.err;
      });
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({
        'request-id': 1,
        response: {
          'user-info': {},
          'controller-tag': 'controller-42',
          facades: [{name: 'ModelManager', versions: [2]}]
        }
      });
      assert.strictEqual(fired, true);
      assert.strictEqual(err, null);
    });

    it('resets failed markers on successful login', function() {
      controllerAPI.failedAuthentication = true;
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({
        'request-id': 1,
        response: {
          'user-info': {},
          'controller-tag': 'controller-42',
          facades: [{name: 'ModelManager', versions: [2]}]
        }
      });
      assert.isFalse(controllerAPI.failedAuthentication);
    });

    it('fires a login event on failed login', function() {
      let fired = false;
      let err;
      controllerAPI.on('login', evt => {
        fired = true;
        err = evt.err;
      });
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({'request-id': 1, error: 'Invalid user or password'});
      assert.strictEqual(fired, true);
      assert.strictEqual(err, 'Invalid user or password');
    });

    it('avoids sending login requests without credentials', function() {
      controllerAPI.setCredentials(null);
      controllerAPI.login();
      assert.equal(0, conn.messages.length);
    });

    it('stores user information', function() {
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({'request-id': 1, response: {
        facades: [
          {name: 'Client', versions: [0]},
          {name: 'ModelManager', versions: [2]}
        ],
        'controller-tag': 'controller-42',
        'user-info': {'controller-access': 'addmodel', 'model-access': ''}
      }});
      assert.strictEqual(controllerAPI.get('controllerAccess'), 'addmodel');
    });
  });

  describe('login with macaroons', function() {
    var error;

    // Create a callback to use when handling responses.
    var callback = function(err) {
      error = err;
    };

    // Create a fake bakery object with the given discharge fuction.
    var makeBakery = function(dischargeFunc) {
      return {discharge: dischargeFunc};
    };

    // Check that the given message sent to the WebSocket is what we expect.
    // Return the request id.
    var assertRequest = function(msg, macaroons) {
      assert.strictEqual(msg.type, 'Admin');
      assert.strictEqual(msg.request, 'Login');
      assert.strictEqual(msg.version, 3);
      if (macaroons) {
        assert.deepEqual(msg.params, {macaroons: [macaroons]});
      } else {
        assert.deepEqual(msg.params, {});
      }
      return msg['request-id'];
    };

    beforeEach(function() {
      error = '';
    });

    it('does not proceed if a login is pending', function() {
      controllerAPI.pendingLoginResponse = true;
      controllerAPI.loginWithMacaroon();
      assert.strictEqual(conn.messages.length, 0, 'unexpected messages');
    });

    it('sends an initial login request without macaroons', function() {
      controllerAPI.loginWithMacaroon(makeBakery());
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      assertRequest(conn.last_message());
    });

    it('sends an initial login request with macaroons', function() {
      controllerAPI.setCredentials({macaroons: ['macaroon']});
      controllerAPI.loginWithMacaroon(makeBakery());
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      assertRequest(conn.last_message(), ['macaroon']);
    });

    it('handles initial response errors', function() {
      controllerAPI.loginWithMacaroon(makeBakery(), callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({'request-id': requestId, error: 'bad wolf'});
      assert.strictEqual(error, 'authentication failed: bad wolf');
    });

    it('sends a second message after discharge', function() {
      var bakery = makeBakery(function(macaroon, success, fail) {
        assert.strictEqual(macaroon, 'discharge-required-macaroon');
        success(['macaroon', 'discharge']);
      });
      controllerAPI.loginWithMacaroon(bakery, callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({
        'request-id': requestId,
        response: {'discharge-required': 'discharge-required-macaroon'}
      });
      assert.strictEqual(conn.messages.length, 2, 'unexpected msg number');
      assertRequest(conn.last_message(), ['macaroon', 'discharge']);
    });

    it('handles discharge failures', function() {
      var bakery = makeBakery(function(macaroon, success, fail) {
        fail('bad wolf');
      });
      controllerAPI.loginWithMacaroon(bakery, callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({
        'request-id': requestId,
        response: {'discharge-required': 'discharge-required-macaroon'}
      });
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      assert.strictEqual(error, 'macaroon discharge failed: bad wolf');
    });

    it('fails if user info is not provided in response', function() {
      controllerAPI.loginWithMacaroon(makeBakery(), callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({'request-id': requestId, response: {}});
      assert.strictEqual(
        error, 'authentication failed: use a proper Juju 2 release');
    });

    it('succeeds after discharge', function() {
      const bakery = makeBakery(function(macaroon, success, fail) {
        assert.strictEqual(macaroon, 'discharge-required-macaroon');
        success(['macaroon', 'discharge']);
      });
      controllerAPI.loginWithMacaroon(bakery, callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      let requestId = assertRequest(conn.last_message());
      conn.msg({
        'request-id': requestId,
        response: {'discharge-required': 'discharge-required-macaroon'}
      });
      assert.strictEqual(conn.messages.length, 2, 'unexpected msg number');
      requestId = assertRequest(
        conn.last_message(), ['macaroon', 'discharge']);
      conn.msg({
        'request-id': requestId,
        response: {
          'user-info': {identity: 'user-who'},
          'controller-tag': 'controller-42',
          facades: [
            {name: 'Client', versions: [42, 47]},
            {name: 'ModelManager', versions: [2]}
          ]
        }
      });
      assert.strictEqual(error, null);
      const creds = controllerAPI.getCredentials();
      assert.strictEqual(creds.user, 'who@local');
      assert.strictEqual(creds.password, '');
      assert.deepEqual(creds.macaroons, ['macaroon', 'discharge']);
      assert.deepEqual(controllerAPI.get('facades'), {
        Client: [42, 47],
        ModelManager: [2]
      });
    });

    it('succeeds with already stored macaroons', function() {
      controllerAPI.setCredentials(
        {macaroons: ['already stored', 'macaroons']});
      controllerAPI.loginWithMacaroon(makeBakery(), callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      const requestId = assertRequest(
        conn.last_message(), ['already stored', 'macaroons']);
      conn.msg({
        'request-id': requestId,
        response: {
          'user-info': {identity: 'user-dalek'},
          'controller-tag': 'controller-42',
          facades: [
            {name: 'Client', versions: [0]},
            {name: 'ModelManager', versions: [2]}
          ]
        }
      });
      assert.strictEqual(error, null);
      const creds = controllerAPI.getCredentials();
      assert.strictEqual(creds.user, 'dalek@local');
      assert.strictEqual(creds.password, '');
      assert.deepEqual(creds.macaroons, ['already stored', 'macaroons']);
      assert.deepEqual(controllerAPI.get('facades'), {
        Client: [0],
        ModelManager: [2]
      });
    });

  });

  describe('websocket connection', function() {
    it('ignores rpc requests when websocket is not connected', function() {
      // Set the readyState to 2 for CLOSING.
      conn.readyState = 2;
      controllerAPI._send_rpc({
        type: 'ModelManager',
        request: 'ModelInfo',
        version: 1,
        'request-id': 1,
        params: {}
      });
      // No calls should be made.
      assert.equal(conn.messages.length, 0);
    });

    it('pings the server correctly', function() {
      controllerAPI.ping();
      var expectedMessage = {
        type: 'Pinger',
        request: 'Ping',
        version: 1,
        'request-id': 1,
        params: {}
      };
      assert.deepEqual(conn.last_message(), expectedMessage);
    });

    it('provides for a missing Params', function() {
      // If no "Params" are provided in an RPC call an empty one is added.
      var op = {type: 'ModelManager'};
      controllerAPI._send_rpc(op);
      assert.deepEqual(op.params, {});
    });
  });

  describe('getBundleChanges', () => {
    it('requests the changes from Juju using a YAML content', () => {
      const yaml = 'foo:\n  bar: baz';
      const callback = sinon.stub();
      controllerAPI.getBundleChanges(yaml, null, callback);
      const msg = conn.last_message();
      assert.deepEqual(msg, {
        'request-id': 1,
        type: 'Bundle',
        version: 1,
        request: 'GetChanges',
        params: {yaml: yaml}
      });
    });

    it('ignores token requests for bundle changes', () => {
      const callback = sinon.stub();
      controllerAPI.getBundleChanges(null, 'TOKEN', callback);
      const msg = conn.last_message();
      assert.deepEqual(msg, {
        'request-id': 1,
        type: 'Bundle',
        version: 1,
        request: 'GetChanges',
        params: {yaml: null}
      });
    });

    it('handles processing the bundle changes response', () => {
      const yaml = 'foo:\n  bar: baz';
      const callback = sinon.stub();
      controllerAPI.getBundleChanges(yaml, null, callback);
      const msg = conn.last_message();
      controllerAPI.dispatch_result({
        'request-id': msg['request-id'],
        response: {changes: ['foo']}
      });
      assert.equal(callback.callCount, 1);
      assert.strictEqual(callback.lastCall.args.length, 2);
      assert.deepEqual(callback.lastCall.args[0], []);
      assert.deepEqual(callback.lastCall.args[1], ['foo']);
    });

    it('handles bundle changes error responses', () => {
      const yaml = 'foo:\n  bar: baz';
      const callback = sinon.stub();
      controllerAPI.getBundleChanges(yaml, null, callback);
      const msg = conn.last_message();
      controllerAPI.dispatch_result({
        'request-id': msg['request-id'],
        response: {errors: ['bad wolf']}
      });
      assert.equal(callback.callCount, 1);
      assert.deepEqual(callback.lastCall.args[0], ['bad wolf']);
      assert.deepEqual(callback.lastCall.args[1], []);
    });

    it('handles yaml parsing errors from Juju', () => {
      const yaml = 'foo:\n  bar: baz';
      const callback = sinon.stub();
      controllerAPI.getBundleChanges(yaml, null, callback);
      const msg = conn.last_message();
      controllerAPI.dispatch_result({
        'request-id': msg['request-id'],
        error: 'bad wolf'
      });
      assert.equal(callback.callCount, 1);
      assert.deepEqual(callback.lastCall.args[0], ['bad wolf']);
      assert.deepEqual(callback.lastCall.args[1], []);
    });

    it('falls back to the bundle service if not authenticated', done => {
      controllerAPI.userIsAuthenticated = false;
      const yaml = 'foo:\n  bar: baz';
      controllerAPI.set('bundleService', {
        getBundleChangesFromYAML: (bundleYAML, cb) => {
          assert.strictEqual(bundleYAML, yaml);
          cb(null, ['change1', 'change2']);
        }
      });
      controllerAPI.getBundleChanges(yaml, null, (err, changes) => {
        assert.deepEqual(err, []);
        assert.deepEqual(changes, ['change1', 'change2']);
        done();
      });
    });

    it('properly reports bundle service errors', done => {
      controllerAPI.userIsAuthenticated = false;
      controllerAPI.set('bundleService', {
        getBundleChangesFromYAML: (bundleYAML, cb) => {
          cb('bad wolf', null);
        }
      });
      controllerAPI.getBundleChanges('not valid', null, (err, changes) => {
        assert.deepEqual(err, ['bad wolf']);
        assert.deepEqual(changes, []);
        done();
      });
    });
  });

  describe('destroyModels', function() {
    it('destroys models', done => {
      // Perform the request.
      controllerAPI.destroyModels(['default'], (err, results) => {
        assert.strictEqual(err, null);
        assert.deepEqual(results, {default: null});
        assert.strictEqual(conn.messages.length, 1);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          type: 'ModelManager',
          version: 2,
          request: 'DestroyModels',
          params: {entities: [
            {tag: 'model-default'}
          ]},
          'request-id': 1
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}]}
      });
    });

    it('destroys multiple models', done => {
      // Perform the request.
      controllerAPI.destroyModels(['test-1', 'test-2'], (err, results) => {
        assert.strictEqual(err, null);
        assert.deepEqual(results, {'test-1': null, 'test-2': null});
        assert.strictEqual(conn.messages.length, 1);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          type: 'ModelManager',
          version: 2,
          request: 'DestroyModels',
          params: {entities: [
            {tag: 'model-test-1'},
            {tag: 'model-test-2'}
          ]},
          'request-id': 1
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}, {}]}
      });
    });

    it('handles local failures while destroying models', done => {
      // Perform the request.
      controllerAPI.destroyModels(['m1', 'm2', 'm3'], (err, results) => {
        assert.strictEqual(err, null);
        assert.deepEqual(results, {
          m1: 'bad wolf',
          m2: null,
          m3: 'end of the universe'
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [
          {error: {message: 'bad wolf'}},
          {},
          {error: {message: 'end of the universe'}}
        ]}
      });
    });

    it('handles global failures while destroying models', done => {
      // Perform the request.
      controllerAPI.destroyModels(['default'], (err, results) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(results, {});
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });
  });

  describe('modelInfo', function() {
    it('retrieves model info for a single model', done => {
      // Perform the request.
      const id = '5bea955d-7a43-47d3-89dd-b02c923e';
      controllerAPI.modelInfo([id], (err, models) => {
        assert.strictEqual(err, null);
        assert.strictEqual(models.length, 1);
        const result = models[0];
        assert.strictEqual(result.id, id);
        assert.strictEqual(result.name, 'admin');
        assert.strictEqual(result.series, 'trusty');
        assert.strictEqual(result.provider, 'lxd');
        assert.strictEqual(result.uuid, '5bea955d-7a43-47d3-89dd-b02c923e');
        assert.strictEqual(result.controllerUUID, '5bea955d-7a43-47d3-89dd');
        assert.strictEqual(result.life, 'alive');
        assert.strictEqual(result.owner, 'admin@local');
        assert.strictEqual(result.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result.isController, false,
                           'unexpected controller model');
        assert.equal(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [{tag: 'model-' + id}]},
          'request-id': 1
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            result: {
              'default-series': 'trusty',
              name: 'admin',
              'provider-type': 'lxd',
              uuid: '5bea955d-7a43-47d3-89dd-b02c923e',
              'controller-uuid': '5bea955d-7a43-47d3-89dd',
              life: 'alive',
              'owner-tag': 'user-admin@local'
            }
          }]
        }
      });
    });

    it('detects controller models', done => {
      // Perform the request.
      const id = '5bea955d-7a43-47d3-89dd-b02c923e';
      controllerAPI.modelInfo([id], (err, models) => {
        const result = models[0];
        assert.strictEqual(result.isController, true,
                           'unexpected regular model');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            result: {
              'default-series': 'trusty',
              name: 'controller',
              'provider-type': 'lxd',
              uuid: '5bea955d-7a43-47d3-89dd-b02c923e',
              'controller-uuid': '5bea955d-7a43-47d3-89dd',
              life: 'alive',
              'owner-tag': 'user-admin@local'
            }
          }]
        }
      });
    });

    it('retrieves model info for multiple models', done => {
      // Perform the request.
      const id1 = '5bea955d-7a43-47d3-89dd-1';
      const id2 = '5bea955d-7a43-47d3-89dd-2';
      controllerAPI.modelInfo([id1, id2], (err, models) => {
        assert.strictEqual(err, null);
        assert.strictEqual(models.length, 2);
        const result1 = models[0];
        assert.strictEqual(result1.id, id1);
        assert.strictEqual(result1.name, 'model1');
        assert.strictEqual(result1.series, 'trusty');
        assert.strictEqual(result1.provider, 'lxd');
        assert.strictEqual(result1.uuid, id1);
        assert.strictEqual(result1.controllerUUID, id1);
        assert.strictEqual(result1.life, 'alive');
        assert.strictEqual(result1.owner, 'admin@local');
        assert.strictEqual(result1.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result1.isController, false,
                           'unexpected controller model');
        const result2 = models[1];
        assert.strictEqual(result2.id, id2);
        assert.strictEqual(result2.name, 'model2');
        assert.strictEqual(result2.series, 'xenial');
        assert.strictEqual(result2.provider, 'aws');
        assert.strictEqual(result2.uuid, id2);
        assert.strictEqual(result2.controllerUUID, '5bea955d-7a43-c2');
        assert.strictEqual(result2.life, 'dying');
        assert.strictEqual(result2.owner, 'dalek@skaro');
        assert.strictEqual(result2.isAlive, false, 'unexpected alive model');
        assert.strictEqual(result2.isController, false,
                           'unexpected controller model');
        assert.equal(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [
            {tag: 'model-' + id1},
            {tag: 'model-' + id2}
          ]},
          'request-id': 1
        });
        done();
      });

      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            result: {
              'default-series': 'trusty',
              name: 'model1',
              'provider-type': 'lxd',
              uuid: id1,
              'controller-uuid': id1,
              life: 'alive',
              'owner-tag': 'user-admin@local'
            }
          }, {
            result: {
              'default-series': 'xenial',
              name: 'model2',
              'provider-type': 'aws',
              uuid: id2,
              'controller-uuid': '5bea955d-7a43-c2',
              life: 'dying',
              'owner-tag': 'user-dalek@skaro'
            }
          }]
        }
      });
    });

    it('handles request failures while fetching model info', done => {
      // Perform the request.
      controllerAPI.modelInfo(['5bea955d-7a43-47d3'], (err, models) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(models, []);
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('handles API failures while retrieving model info', done => {
      // Perform the request.
      const id = '5bea955d-7a43-47d3-89dd';
      controllerAPI.modelInfo([id], (err, models) => {
        assert.strictEqual(err, null);
        assert.strictEqual(models.length, 1);
        const result = models[0];
        assert.strictEqual(result.id, id);
        assert.strictEqual(result.err, 'bad wolf');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            error: {message: 'bad wolf'}
          }]
        }
      });
    });

    it('handles unexpected failures while getting model info', done => {
      // Perform the request.
      controllerAPI.modelInfo(['5bea955d-7a43-47d3'], (err, models) => {
        assert.strictEqual(err, 'unexpected results: []');
        assert.deepEqual(models, []);
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, response: {results: []}});
    });
  });

  describe('listModelsWithInfo', function() {
    it('info for a single model', done => {
      controllerAPI.setCredentials({user: 'who', password: 'tardis'});
      // Perform the request.
      controllerAPI.listModelsWithInfo((err, models) => {
        assert.strictEqual(err, null);
        assert.strictEqual(models.length, 1);
        const result = models[0];
        assert.strictEqual(result.err, undefined);
        assert.strictEqual(result.id, '5bea955d-1');
        assert.strictEqual(result.name, 'admin');
        assert.strictEqual(result.series, 'trusty');
        assert.strictEqual(result.provider, 'lxd');
        assert.strictEqual(result.uuid, '5bea955d-1');
        assert.strictEqual(result.controllerUUID, '5bea955d-c');
        assert.strictEqual(result.life, 'alive');
        assert.strictEqual(result.owner, 'admin@local');
        assert.strictEqual(result.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result.isController, false,
                           'unexpected controller model');
        assert.strictEqual(result.lastConnection, 'today');
        assert.equal(conn.messages.length, 2);
        assert.deepEqual(conn.messages[0], {
          type: 'ModelManager',
          version: 2,
          request: 'ListModels',
          params: {tag: 'user-who@local'},
          'request-id': 1
        });
        assert.deepEqual(conn.messages[1], {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [{tag: 'model-5bea955d-1'}]},
          'request-id': 2
        });
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'admin',
              'owner-tag': 'user-who',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({
        'request-id': 2,
        response: {
          results: [{
            result: {
              'default-series': 'trusty',
              name: 'admin',
              'provider-type': 'lxd',
              uuid: '5bea955d-1',
              'controller-uuid': '5bea955d-c',
              life: 'alive',
              'owner-tag': 'user-admin@local'
            }
          }]
        }
      });
    });

    it('info for multiple models', done => {
      controllerAPI.setCredentials(
        {user: 'dalek@external', password: 'exterminate'});
      // Perform the request.
      controllerAPI.listModelsWithInfo((err, models) => {
        assert.strictEqual(err, null);
        assert.strictEqual(models.length, 3);
        const result1 = models[0];
        assert.strictEqual(result1.err, undefined);
        assert.strictEqual(result1.id, '5bea955d-1');
        assert.strictEqual(result1.name, 'default');
        assert.strictEqual(result1.series, 'xenial');
        assert.strictEqual(result1.provider, 'lxd');
        assert.strictEqual(result1.uuid, '5bea955d-1');
        assert.strictEqual(result1.controllerUUID, '5bea955d-c');
        assert.strictEqual(result1.life, 'dead');
        assert.strictEqual(result1.owner, 'dalek@local');
        assert.strictEqual(result1.isAlive, false, 'unexpected alive model');
        assert.strictEqual(result1.isController, false,
                           'unexpected admin model');
        assert.strictEqual(result1.lastConnection, 'today');
        const result2 = models[1];
        assert.strictEqual(result2.err, undefined);
        assert.strictEqual(result2.id, '5bea955d-c');
        assert.strictEqual(result2.name, 'admin');
        assert.strictEqual(result2.series, 'trusty');
        assert.strictEqual(result2.provider, 'lxd');
        assert.strictEqual(result2.uuid, '5bea955d-c');
        assert.strictEqual(result2.controllerUUID, '5bea955d-c');
        assert.strictEqual(result2.life, 'alive');
        assert.strictEqual(result2.owner, 'who@local');
        assert.strictEqual(result2.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result2.isController, false,
                           'unexpected controller model');
        assert.strictEqual(result2.lastConnection, 'yesterday');
        const result3 = models[2];
        assert.strictEqual(result3.err, undefined);
        assert.strictEqual(result3.id, '5bea955d-3');
        assert.strictEqual(result3.name, 'mymodel');
        assert.strictEqual(result3.series, 'precise');
        assert.strictEqual(result3.provider, 'aws');
        assert.strictEqual(result3.uuid, '5bea955d-3');
        assert.strictEqual(result3.controllerUUID, '5bea955d-c');
        assert.strictEqual(result3.life, 'alive');
        assert.strictEqual(result3.owner, 'cyberman@local');
        assert.strictEqual(result3.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result3.isController, false,
                           'unexpected controller model');
        assert.strictEqual(result3.lastConnection, 'tomorrow');
        assert.equal(conn.messages.length, 2);
        assert.deepEqual(conn.messages[0], {
          type: 'ModelManager',
          version: 2,
          request: 'ListModels',
          params: {tag: 'user-dalek@external'},
          'request-id': 1
        });
        assert.deepEqual(conn.messages[1], {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [
            {tag: 'model-5bea955d-1'},
            {tag: 'model-5bea955d-c'},
            {tag: 'model-5bea955d-3'}
          ]},
          'request-id': 2
        });
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'default',
              'owner-tag': 'user-dalek',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }, {
            model: {
              name: 'admin',
              'owner-tag': 'user-who',
              uuid: '5bea955d-c'
            },
            'last-connection': 'yesterday'
          }, {
            model: {
              name: 'mymodel',
              'owner-tag': 'user-cyberman',
              uuid: '5bea955d-3'
            },
            'last-connection': 'tomorrow'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({
        'request-id': 2,
        response: {
          results: [{
            result: {
              'default-series': 'xenial',
              name: 'default',
              'provider-type': 'lxd',
              uuid: '5bea955d-1',
              'controller-uuid': '5bea955d-c',
              life: 'dead',
              'owner-tag': 'user-dalek@local'
            }
          }, {
            result: {
              'default-series': 'trusty',
              name: 'admin',
              'provider-type': 'lxd',
              uuid: '5bea955d-c',
              'controller-uuid': '5bea955d-c',
              life: 'alive',
              'owner-tag': 'user-who@local'
            }
          }, {
            result: {
              'default-series': 'precise',
              name: 'mymodel',
              'provider-type': 'aws',
              uuid: '5bea955d-3',
              'controller-uuid': '5bea955d-c',
              life: 'alive',
              'owner-tag': 'user-cyberman@local'
            }
          }]
        }
      });
    });

    it('credentials error', done => {
      controllerAPI.setCredentials(null);
      // Perform the request.
      controllerAPI.listModelsWithInfo((err, models) => {
        assert.strictEqual(err, 'called without credentials');
        assert.deepEqual(models, []);
        done();
      });
    });

    it('list models error', done => {
      // Perform the request.
      controllerAPI.listModelsWithInfo((err, models) =>  {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(models, []);
        done();
      });

      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('model info error', done => {
      // Perform the request.
      controllerAPI.listModelsWithInfo((err, models) =>  {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(models, []);
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'default',
              'owner-tag': 'user-dalek',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({'request-id': 2, error: 'bad wolf'});
    });

    it('specific model response error', done => {
      // Perform the request.
      controllerAPI.listModelsWithInfo((err, models) =>  {
        assert.strictEqual(err, null);
        assert.strictEqual(models.length, 1);
        const result = models[0];
        assert.strictEqual(result.id, '5bea955d-1');
        assert.strictEqual(result.err, 'bad wolf');
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'default',
              'owner-tag': 'user-dalek',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({
        'request-id': 2,
        response: {
          results: [{
            error: {message: 'bad wolf'}
          }]
        }
      });
    });
  });

  describe('createModel', function() {
    it('successfully creates a model', done => {
      const user = 'dalek@skaro';
      const args = {
        config: {answer: '42'},
        cloud: 'lxd',
        region: 'galaxy',
        credential: 'dalek'
      };
      controllerAPI.createModel('mymodel', user, args, (err, data) => {
        assert.strictEqual(err, null);
        assert.strictEqual(data.name, 'mymodel');
        assert.strictEqual(data.uuid, 'unique-id');
        assert.strictEqual(data.owner, 'rose@external');
        assert.strictEqual(data.provider, 'lxd');
        assert.strictEqual(data.series, 'xenial');
        assert.strictEqual(data.cloud, 'proxima-centauri');
        assert.strictEqual(data.region, 'alpha-quadrant');
        assert.strictEqual(data.credential, 'dalek');
        assert.equal(conn.messages.length, 1);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          type: 'ModelManager',
          version: 2,
          request: 'CreateModel',
          params: {
            name: 'mymodel',
            'owner-tag': 'user-' + user,
            config: args.config,
            'cloud-tag': 'cloud-' + args.cloud,
            region: args.region,
            credential: 'cloudcred-' + args.credential
          },
          'request-id': 1
        });
        done();
      });
      // Mimic the response to ModelManager.CreateModel.
      conn.msg({
        'request-id': 1,
        response: {
          name: 'mymodel',
          uuid: 'unique-id',
          'owner-tag': 'user-rose@external',
          'provider-type': 'lxd',
          'default-series': 'xenial',
          'cloud-tag': 'cloud-proxima-centauri',
          'cloud-region': 'alpha-quadrant',
          'cloud-credential-tag': 'cloudcred-dalek'
        }
      });
    });

    it('adds local user domain when creating a model', done => {
      // Here we also check that empty/undefined/null args are ignored.
      const args = {config: null, cloud: ''};
      controllerAPI.createModel('mymodel', 'who', args, (err, data) => {
        assert.strictEqual(err, null);
        assert.equal(conn.messages.length, 1);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          type: 'ModelManager',
          version: 2,
          request: 'CreateModel',
          params: {
            name: 'mymodel',
            'owner-tag': 'user-who@local'
          },
          'request-id': 1
        });
        done();
      });
      // Mimic the response to ModelManager.CreateModel.
      conn.msg({
        'request-id': 1,
        response: {
          name: 'mymodel',
          uuid: 'unique-id',
          'owner-tag': 'user-rose@local',
          'provider-type': 'lxd',
          'default-series': 'xenial',
          'cloud-tag': 'cloud-proxima-centauri',
          'cloud-region': 'delta-quadrant',
          'cloud-credential-tag': 'cloudcred-dalek'
        }
      });
    });

    it('handles no cloud credential returned', done => {
      const user = 'dalek@skaro';
      const args = {
        config: {answer: '42'},
        cloud: 'cloud',
        region: 'galaxy'
      };
      controllerAPI.createModel('mymodel', user, args, (err, data) => {
        assert.strictEqual(err, null);
        assert.strictEqual(data.credential, '');
        assert.equal(conn.messages.length, 1);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          type: 'ModelManager',
          version: 2,
          request: 'CreateModel',
          params: {
            name: 'mymodel',
            'owner-tag': 'user-' + user,
            config: args.config,
            'cloud-tag': 'cloud-' + args.cloud,
            region: args.region
          },
          'request-id': 1
        });
        done();
      });
      // Mimic the response to ModelManager.CreateModel.
      conn.msg({
        'request-id': 1,
        response: {
          name: 'mymodel',
          uuid: 'unique-id',
          'owner-tag': 'user-rose@external',
          'provider-type': 'lxd',
          'default-series': 'xenial',
          'cloud-tag': 'cloud-proxima-centauri',
          'cloud-region': 'alpha-quadrant'
        }
      });
    });

    it('handles failures while creating models', done => {
      controllerAPI.createModel('bad-model', 'user-dalek', {}, (err, data) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(data, {});
        done();
      });
      // Mimic the response to ModelManager.CreateModel.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });
  });

  describe('listModels', function() {
    it('lists models for a specific owner', done => {
      controllerAPI.listModels('who', (err, models) => {
        assert.strictEqual(err, null);
        console.log(models);
        assert.deepEqual(models, [
          {
            id: 'unique1',
            name: 'model1',
            owner: 'who',
            uuid: 'unique1',
            lastConnection: 'today'
          },
          {
            id: 'unique2',
            name: 'model2',
            owner: 'rose',
            uuid: 'unique2',
            lastConnection: 'yesterday'
          }
        ]);
        assert.equal(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'ListModels',
          params: {tag: 'user-who'},
          'request-id': 1
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'model1',
              'owner-tag': 'user-who',
              uuid: 'unique1'
            },
            'last-connection': 'today'
          }, {
            model: {
              name: 'model2',
              'owner-tag': 'user-rose',
              uuid: 'unique2'
            },
            'last-connection': 'yesterday'
          }]
        }
      });
    });

    it('handles failures while listing models', done => {
      controllerAPI.listModels('dalek', (err, models) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(models, []);
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('handles no models returned', done => {
      controllerAPI.listModels('dalek', (err, models) => {
        assert.strictEqual(err, null);
        assert.deepEqual(models, []);
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, response: {}});
    });
  });

  describe('listClouds', function() {
    it('retrieves the definitions of supported clouds', function(done) {
      // Perform the request.
      controllerAPI.listClouds((err, clouds) => {
        assert.strictEqual(err, null);
        const expected = {
          'lxd': {
            cloudType: 'lxd',
            authTypes: ['empty'],
            endpoint: 'https://1.2.3.4/lxd-api',
            identityEndpoint: 'https://1.2.3.4/lxd-identity',
            storageEndpoint: 'https://1.2.3.4/lxd-storage',
            regions: [{
              name: 'localhost',
              endpoint: 'https://1.2.3.4/lxd-api-region1',
              identityEndpoint: 'https://1.2.3.4/lxd-identity-region1',
              storageEndpoint: 'https://1.2.3.4/lxd-storage-region1'
            }]
          },
          'google': {
            cloudType: 'gce',
            authTypes: ['userpass', 'oauth2'],
            endpoint: 'https://1.2.3.4/google-api',
            identityEndpoint: 'https://1.2.3.4/google-identity',
            storageEndpoint: 'https://1.2.3.4/google-storage',
            regions: [{
              name: 'federation space',
              endpoint: 'https://1.2.3.4/lxd-api-alpha-beta-quadrants',
              identityEndpoint: 'https://1.2.3.4/lxd-identity-region2',
              storageEndpoint: 'https://1.2.3.4/lxd-storage-region2'
            }, {
              name: 'dominion',
              endpoint: 'https://1.2.3.4/lxd-api-gamma-quadrant',
              identityEndpoint: 'https://1.2.3.4/lxd-identity-region1',
              storageEndpoint: 'https://1.2.3.4/lxd-storage-region1'
            }]
          },
          'guimaas': {
            cloudType: 'maas',
            authTypes: ['oauth1'],
            endpoint: 'http://maas.jujugui.org/MAAS',
            identityEndpoint: '',
            storageEndpoint: '',
            regions: null
          }
        };
        assert.deepEqual(clouds, expected);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          'request-id': 1,
          type: 'Cloud',
          request: 'Clouds',
          version: 1,
          params: {}
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          clouds: {
            'cloud-lxd': {
              type: 'lxd',
              'auth-types': ['empty'],
              endpoint: 'https://1.2.3.4/lxd-api',
              'identity-endpoint': 'https://1.2.3.4/lxd-identity',
              'storage-endpoint': 'https://1.2.3.4/lxd-storage',
              regions: [{
                name: 'localhost',
                endpoint: 'https://1.2.3.4/lxd-api-region1',
                'identity-endpoint': 'https://1.2.3.4/lxd-identity-region1',
                'storage-endpoint': 'https://1.2.3.4/lxd-storage-region1'
              }]
            },
            'cloud-google': {
              type: 'gce',
              'auth-types': ['userpass', 'oauth2'],
              endpoint: 'https://1.2.3.4/google-api',
              'identity-endpoint': 'https://1.2.3.4/google-identity',
              'storage-endpoint': 'https://1.2.3.4/google-storage',
              regions: [{
                name: 'federation space',
                endpoint: 'https://1.2.3.4/lxd-api-alpha-beta-quadrants',
                'identity-endpoint': 'https://1.2.3.4/lxd-identity-region2',
                'storage-endpoint': 'https://1.2.3.4/lxd-storage-region2'
              }, {
                name: 'dominion',
                endpoint: 'https://1.2.3.4/lxd-api-gamma-quadrant',
                'identity-endpoint': 'https://1.2.3.4/lxd-identity-region1',
                'storage-endpoint': 'https://1.2.3.4/lxd-storage-region1'
              }],
            },
            'cloud-guimaas': {
              'type':'maas',
              'auth-types':['oauth1'],
              'endpoint':'http://maas.jujugui.org/MAAS'
            }
          }
        }
      });
    });

    it('handles request failures while listing clouds', function(done) {
      // Perform the request.
      controllerAPI.listClouds((err, clouds) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(clouds, {});
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('handles no results while listing clouds', function(done) {
      // Perform the request.
      controllerAPI.listClouds((err, clouds) => {
        assert.strictEqual(err, null);
        assert.deepEqual(clouds, {});
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, response: {}});
    });
  });

  describe('getClouds', function() {
    it('retrieves the requested cloud definitions', function(done) {
      // Perform the request.
      controllerAPI.getClouds(['lxd', 'google', 'no-such'], (err, clouds) => {
        assert.strictEqual(err, null);
        assert.deepEqual(clouds, {
          'lxd': {
            cloudType: 'lxd',
            authTypes: ['empty'],
            endpoint: 'https://1.2.3.4/lxd-api',
            identityEndpoint: 'https://1.2.3.4/lxd-identity',
            storageEndpoint: 'https://1.2.3.4/lxd-storage',
            regions: [{
              name: 'localhost',
              endpoint: 'https://1.2.3.4/lxd-api-region1',
              identityEndpoint: 'https://1.2.3.4/lxd-identity-region1',
              storageEndpoint: 'https://1.2.3.4/lxd-storage-region1'
            }]
          },
          'google': {
            cloudType: 'gce',
            authTypes: ['userpass', 'oauth2'],
            endpoint: 'https://1.2.3.4/google-api',
            identityEndpoint: 'https://1.2.3.4/google-identity',
            storageEndpoint: 'https://1.2.3.4/google-storage',
            regions: [{
              name: 'federation space',
              endpoint: 'https://1.2.3.4/lxd-api-alpha-beta-quadrants',
              identityEndpoint: 'https://1.2.3.4/lxd-identity-region2',
              storageEndpoint: 'https://1.2.3.4/lxd-storage-region2'
            }, {
              name: 'dominion',
              endpoint: 'https://1.2.3.4/lxd-api-gamma-quadrant',
              identityEndpoint: 'https://1.2.3.4/lxd-identity-region1',
              storageEndpoint: 'https://1.2.3.4/lxd-storage-region1'
            }]
          },
          'no-such': {err: 'no such cloud'}
        });
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          'request-id': 1,
          type: 'Cloud',
          request: 'Cloud',
          version: 1,
          params: {entities: [
            {tag: 'cloud-lxd'},
            {tag: 'cloud-google'},
            {tag: 'cloud-no-such'}
          ]}
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            cloud: {
              type: 'lxd',
              'auth-types': ['empty'],
              endpoint: 'https://1.2.3.4/lxd-api',
              'identity-endpoint': 'https://1.2.3.4/lxd-identity',
              'storage-endpoint': 'https://1.2.3.4/lxd-storage',
              regions: [{
                name: 'localhost',
                endpoint: 'https://1.2.3.4/lxd-api-region1',
                'identity-endpoint': 'https://1.2.3.4/lxd-identity-region1',
                'storage-endpoint': 'https://1.2.3.4/lxd-storage-region1'
              }]
            }
          }, {
            cloud: {
              type: 'gce',
              'auth-types': ['userpass', 'oauth2'],
              endpoint: 'https://1.2.3.4/google-api',
              'identity-endpoint': 'https://1.2.3.4/google-identity',
              'storage-endpoint': 'https://1.2.3.4/google-storage',
              regions: [{
                name: 'federation space',
                endpoint: 'https://1.2.3.4/lxd-api-alpha-beta-quadrants',
                'identity-endpoint': 'https://1.2.3.4/lxd-identity-region2',
                'storage-endpoint': 'https://1.2.3.4/lxd-storage-region2'
              }, {
                name: 'dominion',
                endpoint: 'https://1.2.3.4/lxd-api-gamma-quadrant',
                'identity-endpoint': 'https://1.2.3.4/lxd-identity-region1',
                'storage-endpoint': 'https://1.2.3.4/lxd-storage-region1'
              }]
            }
          }, {
            error: {message: 'no such cloud'}
          }]
        }
      });
    });

    it('handles request failures while getting clouds', function(done) {
      // Perform the request.
      controllerAPI.getClouds(['lxd'], (err, clouds) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(clouds, {});
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('returns no results if no tags are provided', function(done) {
      // Perform the request.
      controllerAPI.getClouds([], (err, clouds) => {
        assert.strictEqual(err, null);
        assert.deepEqual(clouds, {});
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, response: {}});
    });
  });

  describe('getDefaultCloudName', function() {
    it('retrieves the default cloud name', function(done) {
      // Perform the request.
      controllerAPI.getDefaultCloudName((err, name) => {
        assert.strictEqual(err, null);
        assert.strictEqual(name, 'lxd');
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          'request-id': 1,
          type: 'Cloud',
          request: 'DefaultCloud',
          version: 1,
          params: {}
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {result: 'cloud-lxd'},
      });
    });

    it('handles request failures while getting default name', function(done) {
      // Perform the request.
      controllerAPI.getDefaultCloudName((err, name) => {
        assert.strictEqual(err, 'bad wolf');
        assert.strictEqual(name, '');
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('handles API failures while getting default name', function(done) {
      // Perform the request.
      controllerAPI.getDefaultCloudName((err, name) => {
        assert.strictEqual(err, 'bad wolf');
        assert.strictEqual(name, '');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {error: {message: 'bad wolf'}}
      });
    });
  });

  describe('getCloudCredentialNames', function() {

    it('retrieves names for cloud credentials', function(done) {
      // Perform the request.
      const pairs = [
        ['who@gallifrey', 'lxd'],
        ['dalek@skaro', 'google'],
        ['rose@earth', 'google']
      ];
      controllerAPI.getCloudCredentialNames(pairs, (err, results) => {
        assert.strictEqual(err, null);
        assert.deepEqual(results, [
          {names: ['name1', 'name2']},
          {err: 'bad wolf'},
          {names: ['name3']},
        ]);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          'request-id': 1,
          type: 'Cloud',
          request: 'UserCredentials',
          version: 1,
          params: {'user-clouds': [
            {'user-tag': 'user-who@gallifrey', 'cloud-tag': 'cloud-lxd'},
            {'user-tag': 'user-dalek@skaro', 'cloud-tag': 'cloud-google'},
            {'user-tag': 'user-rose@earth', 'cloud-tag': 'cloud-google'}
          ]}
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            result: ['cloudcred-name1', 'cloudcred-name2'],
          }, {
            error: {message: 'bad wolf'},
          }, {
            result: ['cloudcred-name3'],
          }]
        }
      });
    });

    it('handles request failures while getting names', function(done) {
      // Perform the request.
      const pairs = [['who@gallifrey', 'lxd']];
      controllerAPI.getCloudCredentialNames(pairs, (err, results) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(results, []);
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('returns no results if no user/cloud pairs are passed', function(done) {
      // Perform the request.
      controllerAPI.getCloudCredentialNames([], (err, results) => {
        assert.strictEqual(err, null);
        assert.deepEqual(results, []);
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, response: {}});
    });
  });

  describe('getCloudCredentials', function() {
    it('retrieves the requested credentials by name', function(done) {
      // Perform the request.
      const names = ['cred1', 'cred2', 'no-such'];
      controllerAPI.getCloudCredentials(names, (err, creds) => {
        assert.strictEqual(err, null);
        assert.deepEqual(creds, {
          cred1: {
            authType: 'jsonfile',
            attrs: {
              type: 'service_account',
              project_id: 'juju-42',
              private_key_id: 'my-private-key-id'
            },
            redacted: ['secret', 'confidential']
          },
          cred2: {
            authType: 'oauth2',
            attrs: {},
            redacted: []
          },
          'no-such': {err: 'no such credentials'}
        });
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          'request-id': 1,
          type: 'Cloud',
          request: 'Credential',
          version: 1,
          params: {entities: [
            {tag: 'cloudcred-cred1'},
            {tag: 'cloudcred-cred2'},
            {tag: 'cloudcred-no-such'}
          ]}
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            result: {
              'auth-type': 'jsonfile',
              attrs: {
                type: 'service_account',
                project_id: 'juju-42',
                private_key_id: 'my-private-key-id'
              },
              redacted: ['secret', 'confidential']
            }
          }, {
            result: {
              'auth-type': 'oauth2',
            }
          }, {
            error: {message: 'no such credentials'}
          }]
        }
      });
    });

    it('handles request failures while getting credentials', function(done) {
      // Perform the request.
      controllerAPI.getCloudCredentials(['invalid'], (err, creds) => {
        assert.strictEqual(err, 'bad wolf');
        assert.deepEqual(creds, {});
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('returns no results if no tags are provided', function(done) {
      // Perform the request.
      controllerAPI.getCloudCredentials([], (err, creds) => {
        assert.strictEqual(err, null);
        assert.deepEqual(creds, {});
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, response: {}});
    });
  });

  describe('updateCloudCredential', function() {
    it('updates cloud credentials', function(done) {
      // Perform the request.
      const name = 'banna';
      const authType = 'empty';
      const attrs = {answer: '42'};
      controllerAPI.updateCloudCredential(name, authType, attrs, err => {
        assert.strictEqual(err, null);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          'request-id': 1,
          type: 'Cloud',
          request: 'UpdateCredentials',
          version: 1,
          params: {credentials: [{
            tag: 'cloudcred-' + name,
            credential: {'auth-type': authType, attrs: attrs}
          }]}
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}]}
      });
    });

    it('handles request failures while updating credentials', function(done) {
      // Perform the request.
      controllerAPI.updateCloudCredential('credname', '', {}, err => {
        assert.strictEqual(err, 'bad wolf');
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('handles API failures while updating credentials', function(done) {
      // Perform the request.
      controllerAPI.updateCloudCredential('credname', '', {}, err => {
        assert.strictEqual(err, 'bad wolf');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{error: {message: 'bad wolf'}}]}
      });
    });

    it('fails for unexpected results updating credentials', function(done) {
      // Perform the request.
      controllerAPI.updateCloudCredential('credname', '', {}, err => {
        assert.strictEqual(err, 'invalid results from Juju: [{},{}]');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}, {}]}
      });
    });

    it('fails for no results updating credentials', function(done) {
      // Perform the request.
      controllerAPI.updateCloudCredential('credname', '', {}, err => {
        assert.strictEqual(err, 'invalid results from Juju: []');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: []}
      });
    });
  });

  describe('revokeCloudCredential', function() {
    it('revokes cloud credentials', function(done) {
      // Perform the request.
      controllerAPI.revokeCloudCredential('banna', err => {
        assert.strictEqual(err, null);
        const msg = conn.last_message();
        assert.deepEqual(msg, {
          'request-id': 1,
          type: 'Cloud',
          request: 'RevokeCredentials',
          version: 1,
          params: {entities: [{
            tag: 'cloudcred-banna',
          }]}
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}]}
      });
    });

    it('handles request failures while revoking credentials', function(done) {
      // Perform the request.
      controllerAPI.revokeCloudCredential('banna', err => {
        assert.strictEqual(err, 'bad wolf');
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('handles API failures while revoking credentials', function(done) {
      // Perform the request.
      controllerAPI.revokeCloudCredential('kaffa', err => {
        assert.strictEqual(err, 'bad wolf');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{error: {message: 'bad wolf'}}]}
      });
    });

    it('fails for unexpected results revoking credentials', function(done) {
      // Perform the request.
      controllerAPI.revokeCloudCredential('latta', err => {
        assert.strictEqual(err, 'invalid results from Juju: [{},{}]');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}, {}]}
      });
    });

    it('fails for no results revoking credentials', function(done) {
      // Perform the request.
      controllerAPI.revokeCloudCredential('invalid', err => {
        assert.strictEqual(err, 'invalid results from Juju: []');
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: []}
      });
    });
  });

});
