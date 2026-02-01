// Test AMEEX Parcel Info API
const trackingCode = 'AGA0226B8317UX4839236';
const apiId = '8317';
const apiKey = '919854-260Ee9-fA5C58-7D4E1E-3A6017-7A59a4';

const url = `https://api.ameex.app/customer/Delivery/Parcels/Info?ParcelCode=${trackingCode}`;

console.log('Testing AMEEX Parcel Info API...');
console.log('URL:', url);

fetch(url, {
    method: 'GET',
    headers: {
        'C-Api-Id': apiId,
        'C-Api-Key': apiKey,
        'Content-Type': 'application/json'
    }
})
    .then(response => {
        console.log('\nResponse Status:', response.status);
        return response.text();
    })
    .then(text => {
        console.log('\nRaw Response:', text);
        try {
            const json = JSON.parse(text);
            console.log('\nParsed JSON:', JSON.stringify(json, null, 2));
        } catch (e) {
            console.log('Not JSON format');
        }
    })
    .catch(error => {
        console.error('Error:', error);
    });
