const request = require("request-promise");
const {vkToken} = require("./constants/secure");

const apiRequest = async (method, apiParams) => {
    let requestParams = {
        access_token: vkToken,
        v: "5.92",
    };
    let params = {
        method: "POST",
        form: {...requestParams, ...apiParams}
    };
    return new Promise((resolve, reject)=>{
        request('https://api.vk.com/method/'+method,params).then(res=>{
            res = JSON.parse(res);
            resolve(res);
        });
    });
};

module.exports =  apiRequest;