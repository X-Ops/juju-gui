/*
This file is part of the Juju GUI, which lets users view and manage Juju
environments within a graphical interface (https://launchpad.net/juju-gui).
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

var juju = {components: {}}; // eslint-disable-line no-unused-vars

describe('CreateModelButton', () => {

  beforeAll((done) => {
    // By loading this file it adds the component to the juju components.
    YUI().use('create-model-button', () => { done(); });
  });

  it('renders a button with default values', () => {
    const component = jsTestUtils.shallowRender(
      <juju.components.CreateModelButton
        changeState={sinon.stub()}
        switchModel={sinon.stub()} />, true);
    const output = component.getRenderOutput();
    const expected = (
      <div className="user-profile__create-new">
        <juju.components.GenericButton
          action={output.props.children.props.action}
          type="inline-neutral"
          title="Create new" />
      </div>
    );
    assert.deepEqual(output, expected);
  });

  it('renders a button with provided values', () => {
    const component = jsTestUtils.shallowRender(
      <juju.components.CreateModelButton
        type="positive"
        title="test"
        changeState={sinon.stub()}
        switchModel={sinon.stub()} />, true);
    const output = component.getRenderOutput();
    const expected = (
      <div className="user-profile__create-new">
        <juju.components.GenericButton
          action={output.props.children.props.action}
          type="positive"
          title="test" />
      </div>
    );
    assert.deepEqual(output, expected);
  });

  it('closes the profile before switching to a new model', () => {
    const changeState = sinon.stub();
    const switchModel = sinon.stub();
    const component = jsTestUtils.shallowRender(
      <juju.components.CreateModelButton
        type="positive"
        title="test"
        changeState={changeState}
        switchModel={switchModel} />, true);
    const output = component.getRenderOutput();
    // Call the action passed to the GenericButton
    output.props.children.props.action();
    assert.equal(changeState.callCount, 1);
    assert.deepEqual(changeState.args[0], [{profile: null}]);
    assert.equal(switchModel.callCount, 1);
    assert.deepEqual(switchModel.args[0], [null]);
  });
});
