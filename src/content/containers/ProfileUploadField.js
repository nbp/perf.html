import React, { Component, PropTypes } from 'react';
import { connect } from 'react-redux';
import * as actions from '../actions';

class ProfileUploadField extends Component {
  constructor(props) {
    super(props);
    this._onInputChange = this._onInputChange.bind(this);
  }

  _onInputChange(e) {
    const files = e.target.files;
    if (files.length > 0) {
      console.log(files);
      console.log(files[0]);
      const reader = new FileReader();
      console.log(reader.readAsText(files[0]));
      this.props.retrieveProfileFromFile(files[0]);
    }
  }

  render() {
    return (
      <input type='file' onChange={this._onInputChange}/>
    );
  }
}

ProfileUploadField.propTypes = {
  retrieveProfileFromFile: PropTypes.func.isRequired,
};

export default connect(() => ({}), actions)(ProfileUploadField);
