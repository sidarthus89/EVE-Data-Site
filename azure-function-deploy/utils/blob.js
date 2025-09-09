const { BlobServiceClient } = require('@azure/storage-blob');

function getPublicContainerClient() {
    const accountUrl = process.env.BLOB_ACCOUNT_URL; // e.g. https://<acct>.blob.core.windows.net
    const container = process.env.BLOB_PUBLIC_CONTAINER || 'public';
    if (!accountUrl) {
        throw new Error('BLOB_ACCOUNT_URL app setting is required');
    }
    // For public container writes, prefer SAS if provided; otherwise use connection string
    const sas = process.env.BLOB_SAS_TOKEN; // starts with ?
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AZURE_STORAGEBLOB_CONNECTIONSTRING;

    let bsc;
    if (sas) {
        bsc = new BlobServiceClient(`${accountUrl}${sas}`);
    } else if (conn) {
        bsc = BlobServiceClient.fromConnectionString(conn);
    } else {
        // Managed Identity via DefaultAzureCredential isn't available in this minimal setup.
        throw new Error('Provide BLOB_SAS_TOKEN or AZURE_STORAGE_CONNECTION_STRING to enable blob writes');
    }

    return bsc.getContainerClient(container);
}

async function uploadJsonBlob(path, data, cacheControl = 'public, max-age=900') {
    const containerClient = getPublicContainerClient();
    const blobClient = containerClient.getBlockBlobClient(path);
    const body = Buffer.from(JSON.stringify(data));
    await blobClient.upload(body, body.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/json; charset=utf-8',
            blobCacheControl: cacheControl,
        },
    });
    return blobClient.url;
}

module.exports = { getPublicContainerClient, uploadJsonBlob };
