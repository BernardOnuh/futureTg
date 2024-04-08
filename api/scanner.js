// api.js
const axios = require('axios');

module.exports = {
  async getAddressDetails(address) {
    try {
      const apiUrl = 'https://api.honeypot.is/v2/IsHoneypot';
      const response = await axios.get(apiUrl, {
        params: {
          address: address
        }
      });

      return response.data; // Assuming the API response contains the details you need
    } catch (error) {
      throw new Error(`API Error: ${error.message}`);
    }
  },

  async getTokenDetails(address) {
      try {
        const apiUrl = `https://openapi.dexview.com/latest/dex/tokens/${address}`;
        const response = await axios.get(apiUrl, {
          headers: {
            'Accept': '*/*'
          }
        });
    
        // Handle the response data here
        return response.data;
        console.log(response.data);
      } catch (error) {
        // Handle errors here
        console.error(error.message);
      }
  },
};

