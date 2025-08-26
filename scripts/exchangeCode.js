import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const CLIENT_ID = process.env.VITE_EVE_CLIENT_ID;
const SECRET = process.env.EVE_SECRET_KEY;
const CODE = 'rZr0wacWmEikhtfnsjtJNg'; // Replace with your actual code

async function getAccessToken() {
    const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', CODE);
    params.append('redirect_uri', 'https://sidarthus89.github.io/EVE-Data-Site/callback'); // match your app

    const res = await fetch('https://login.eveonline.com/v2/oauth/token', {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    const raw = await res.text();
    try {
        const data = JSON.parse(raw);
        if (!data.access_token) throw new Error('No access token in response');
        return data.access_token;
    } catch (err) {
        console.error('❌ Raw response:', raw);
        throw new Error('Failed to parse token response');
    }
}

async function getCharacterID(token) {
    const res = await fetch('https://esi.evetech.net/latest/verify/', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    const data = await res.json();
    if (!data.CharacterID) throw new Error('Failed to get character ID');
    return data.CharacterID;
}

(async () => {
    try {
        const token = await getAccessToken();
        const charID = await getCharacterID(token);

        console.log('✅ Access Token:', token);
        console.log('✅ Character ID:', charID);
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
})();