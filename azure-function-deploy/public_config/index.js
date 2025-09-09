module.exports = async function (context, req) {
    const base = process.env.BLOB_PUBLIC_HTTP_BASE || (process.env.BLOB_ACCOUNT_URL ? `${process.env.BLOB_ACCOUNT_URL.replace(/\/$/, '')}/${process.env.BLOB_PUBLIC_CONTAINER || 'public'}` : null);
    context.res = {
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=600' },
        status: 200,
        body: { blobPublicBase: base }
    };
};
