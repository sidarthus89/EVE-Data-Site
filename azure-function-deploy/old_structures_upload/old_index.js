module.exports = async function (context, req) {
  context.log('old_structures_upload invoked (deprecated)');
  context.res = { status: 410, body: { error: 'Deprecated. structures_upload is retired; use GitHub upsert via structures_update pipeline.' } };
};
