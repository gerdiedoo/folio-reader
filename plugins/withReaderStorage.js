const { withGradleProperties } = require('expo/config-plugins');
// Account replicas retain acknowledged revisions and pending edits together.
module.exports = config => withGradleProperties(config, config => {
  config.modResults = config.modResults.filter(item => item.key !== 'AsyncStorage_db_size_in_MB');
  config.modResults.push({ type: 'property', key: 'AsyncStorage_db_size_in_MB', value: '64' });
  return config;
});
