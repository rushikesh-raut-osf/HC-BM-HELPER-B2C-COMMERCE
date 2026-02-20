const path = require('path');

module.exports = {
  entry: {},
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  mode: 'development'
};
