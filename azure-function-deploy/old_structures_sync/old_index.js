const impl = require('../structures_sync/index');

module.exports = async function (context, req) {
  context.log('old_structures_sync invoked (deprecated)');
  return impl(context, req);
};
