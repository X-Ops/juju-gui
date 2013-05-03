'use strict';

/**

  Simulate various types of change to a sandbox environment.
  These can include things like
    - unit/relation failure/recovery
    - unit count changes
    - landscape annotation changes
    - position annotation changes


  @module env
  @submodule env.simulator
*/

YUI.add('juju-fakebackend-simulator', function(Y) {

  var models = Y.namespace('juju.models');
  // How often should we run by default (ms).
  var DEFAULT_INTERVAL = 3000;
  var RAND = function(prob) {
    return Math.random() <= prob;
  };

  var DEFAULT_AGENTS = {
    landscape: {
      start: function(context) {
        // For landscape to work we need to ensure the top level
        // env has the proper setup. This happens once.
        var db = context.state.db;
        var envAnno = db.environment.get('annotations');
        envAnno['landscape-url'] = 'http://landscape.com';
        envAnno['landscape-computers'] = '/computers/criteria/environment:test';
        envAnno['landscape-reboot-alert-url'] =
            '+alert:computer-reboot/info#power';
        envAnno['landscape-security-alert-url'] =
            '+alert:security-upgrades/packages/list?filter=security';
        context.state.updateAnnotations('env', envAnno);
      },

      select: {
        list: 'units',
        random: 0.01
      },

      run: function(context) {
        // Make sure services all have annotation
        // (Apart from selection)
        context.state.db.services.each(function(service) {
          var annotations = service.get('annotations') || {};
          var sid = service.get('id');
          if (!annotations['landscape-computers']) {
            annotations['landscape-computers'] = '/computers/criteria/service:' +
              sid + '+environment:demonstration';
            context.state.updateAnnotations(sid, annotations);
          }
        });

        context.selection.each(function(unit) {
          // Toggle landscape attributes as though they
          var annotations = unit.annotations || {};
          var changed = false;
          if (!annotations['landscape-computer']) {
            annotations['landscape-computer'] = '+unit:' + unit.urlName;
            changed = true;
          }

          // Toggle some annotations.
          if (RAND(0.3)) {
            annotations['landscape-needs-reboot'] = !annotations[
                'landscape-needs-reboot'];
            changed = true;
          }
          if (RAND(0.3)) {
            annotations['landscape-security-upgrades'] = !annotations[
                'landscape-security-upgrades'];
            changed = true;
          }
          if (changed) {
            context.state.updateAnnotations(unit.id, annotations);
          }
        });
      }
    },

    unitCounts: {
      select: {
        list: 'services',
        random: 0.1
      },
      run: function(context) {
        context.selection.each(function(service) {
          if (RAND(0.5)) {
            context.state.addUnit(service.get('id'), 1);
          } else {
            var units = context.state.db.units.get_units_for_service(service);
            if (units.length > 1) {
              var unit = units[units.length - 1];
              context.state.removeUnits([unit.id]);
            }
          }
      });
      }
    },

    unitStatus: {
      select: {
        list: 'units',
        random: 0.05
      },
      run: function(context) {
        context.selection.each(function(unit) {
          var roll = Math.random();
          if (roll <= 0.25) {
            unit.agent_state = 'started';
          } else if (roll <= 0.5) {
            unit.agent_state = 'install-error';
          } else if (roll <= 0.75) {
            unit.agent_state = 'pending';
          }
          //TODO: get_relations_for_service()
          // choose one and set it as a unit.relation_errors entry.
          // update the changes['relations'];

          // Put in delta since there is no API for this.
          context.state.changes.units[unit.id] = [unit, true];
        });

      }
    },

    /*
     This one is a toy playing with position annotations
     */
    position: {
      threshold: 0.01,
      start: function(context) {
        // Not sensitive to size changes.
        // Reach across time and space to look at... client-side.
        var canvas = Y.one('body'),
            width = canvas.getDOMNode().getClientRects()[0].width;
        this.set('width', width);
      },


      select: {
        list: 'services'
      },

      run: function(context) {
        var width = context.width,
            center = context.center;

        context.selection.each(function(s) {
          var annotations = s.get('annotations') || {};
          var x = annotations['gui-x'],
              mirror;;
          if (!Y.Lang.isNumber(x)) {
            return;
          }
          // Mirror relative x position on canvas.
          mirror = width - x;
          annotations['gui-x'] = mirror;
          context.state.updateAnnotations(s.get('id'), annotations);
        });
      }
    }

  };

  /**
    Agents of backend change. Created automatically,
    see Simulator.ATTRS.agents

    @class Agent
    */
  function Agent(config) {
    Agent.superclass.constructor.apply(this, arguments);
  }
  Agent.NAME = 'Agent';
  Agent.ATTRS = {
  };

  Y.extend(Agent, Y.Base, {
    /**
      This tells `Y.Base` that it should create ad-hoc attributes for config
      properties passed to Model's constructor. This makes it possible to
      instantiate a model and set a bunch of attributes without having to
      subclass `Y.Model` and declare all those attributes first.

      @property _allowAdHocAttrs
      @type {Boolean}
      @default true
      @protected
      @since 3.5.0
     */
    _allowAdHocAttrs: true,

    getContext: function() {
      var context = this.getAttrs();
      delete context.initialized;
      delete context.destroyed;
      return context;
    },

    start: function() {
      var context = this.getContext(),
          self = this;
      if (context.start) {
        context.state.onceAfter('authenticatedChange', function() {
          // TODO: Validate that its actually true.
          context.start.call(self, context);
        });
      }
    },

    select: function(context) {
      var select = context.select;
      var db = context.state.db;
      if (!select) {
        return;
      }

      if (select.list) {
        context.selection = db[select.list];
      }
      if (select.filter) {
        // filter should return {asList: true}
        context.selection = select.filter(context);
      }
      // Also filter out any 'pending' items.
      if (context.selection !== undefined) {
        context.selection = context.selection.filter(
          {asList: true}, function(model) {
          return (model.pending ||
                  (model.get && model.get('pending'))) !== true;
        });
      }

      if (select.random) {
        // This requires that a selection is present.
        context.selection = context.selection.filter(
            {asList: true}, function() {
              return Math.random() <= select.random;
            });
      }
    },

    run: function() {
      var context = this.getContext();

      if (context.threshold !== undefined && !RAND(context.threshold)) {
        return;
      }
      // Update selection to act on.
      if (context.select) {
        this.select(context);
      }
      context.run.call(this, context);
    }
  });

  /**
  Humble make-believe manager.

  @class Simulator
  */
  function Simulator(config) {
    // Invoke Base constructor, passing through arguments.
    Simulator.superclass.constructor.apply(this, arguments);
  }

  Simulator.NAME = 'Simulator';
  Simulator.ATTRS = {
    agents: {},
    state: {},
    useDefaultAgents: {value: true},
    interval: {value: DEFAULT_INTERVAL}
  };

  Y.extend(Simulator, Y.Base, {

    /**
    Initializes.

    @method initializer
    @return {undefined} Nothing.
    */
    initializer: function() {
      this._agents = null;
      this._scheduler = null;
      /**
       * Fired on each interval of the scheduler
       * after agents have run.
       * @event tick
       */
      this.publish('tick');

      // WHen our agents property changes
      // regenerate our agents mapping.
      if (this.get('useDefaultAgents')) {
        var agents = this.get('agents') || {};
        this.set('agents', Y.mix(agents, DEFAULT_AGENTS));
      }
      this._updateAgents();
      this.after('stateChange', this._updateAgents, this);
      this.after('agentsChange', this._updateAgents, this);
      return this;
    },

    /**
    Cleanup on destruction.
    @method destructor
    */
    destructor: function() {
      this.stop();
    },

    _updateAgents: function(evt) {
      var decls = this.get('agents');
      var state = this.get('state');
      var agents = {};

      Y.each(decls, function(spec, name) {
        spec = spec || {};
        spec.state = state;
        agents[name] = new Agent(spec);
        agents[name].start();
      });
      this._agents = agents;
    },

    /**
    Start each agent firing 'tick' events when pushing changes.

    @method start
    @chainable
    */
    start: function() {
      var self = this,
          state = this.get('state');
      if (this._scheduler) {
        // Already started, so restart.
        this.stop();
      }

      var scheduler = function() {
        Y.each(self._agents, function(agent, name) {
          agent.run(state);
        });
        self.fire('tick');
      };

      this._scheduler = Y.later(self.get('interval'),
                                self, scheduler, undefined,
                                true);

      // Invoke on start as well.
      scheduler();
      return this;

    },

    /**
    Stop agents from firing or mutating backend.
    @method stop
    @chainable
    */
    stop: function() {
      if (this._scheduler) {
        this._scheduler.cancel();
        this._scheduler = null;
      }
      return this;
    }

  });
  Y.namespace('juju.environments').Simulator = Simulator;


}, '0.1.0', {
  requires: [
    'base',
    'event',
    'juju-models',
    'promise',
    'yui-later'
  ]
});
