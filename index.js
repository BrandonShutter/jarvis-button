const AWS = require('aws-sdk');
AWS.config.region = process.env.REGION;
const lambda = new AWS.Lambda();
const docClient = new AWS.DynamoDB.DocumentClient();
const request = require('request');
const Slack = require("slack-node");

function slack(msg) {

    var webhookUri = process.env.SLACK_WEBHOOK;
    var slack = new Slack();

    slack.setWebhook(webhookUri);
    slack.webhook(msg, function(err, response) {
        if (err) {
            console.log(err);
        } else {
            console.log(msg);
        }
    });

}

function slackSimple(msg) {
    var payload = {
        channel: process.env.SLACK_CHANNEL,
        username: process.env.SLACK_BOT_NAME,
        text: msg
    };
    return payload;
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function formatWeatherInfo(msg, now) {
    
    var payload = {
        channel: process.env.SLACK_CHANNEL,
        username: process.env.SLACK_BOT_NAME,
        text: "Weather forecast for "+capitalizeFirstLetter(process.env.WEATHER_CITY),
        attachments: [{
        }]
    };
        
    msg['list'].forEach(function(item, index) {
        if (index < process.env.MAX_FORECAST_SHOWN) {
            var attachments = {
                color: "#36a64f",
                text: "Forecast for the <!date^"+item['dt']+"^{date_pretty} at {time}|at "+now+" AM> ",
                fields: [
                    {
                        "title": "🌡 Temperature",
                        "value": "Min: "+Math.round(item['main']['temp_min'])+" C°, Max: "+Math.round(item['main']['temp_max'])+" C°",
                        "short": true
                    },
                    {
                        "title": "💦 Umbrella",
                        "value": capitalizeFirstLetter(item['weather'][0]['description'])+" ("+item['rain']['3h']+" mm/m^3 in 3h)",
                        "short": true
                    },
                    {
                        "title": "☁️ Light",
                        "value": "Clouds at "+item['clouds']['all']+"%",
                        "short": true
                    },
                    {
                        "title": "💨 Coldness",
                        "value": "Wind at "+item['wind']['speed'],
                        "short": true
                    },
                ],
                image_url: "http://openweathermap.org/img/w/"+item['weather'][0]['icon']+".png",
                thumb_url: "http://openweathermap.org/img/w/"+item['weather'][0]['icon']+".png",
            };
            if (index == process.env.MAX_FORECAST_SHOWN-1) {
                attachments['ts'] = now.toString()
            }
            payload['attachments'].push(attachments);
        }
    });
    
    return payload;

}

function formatTrafficInfo(msg, now) {

    var payload = {
        channel: process.env.SLACK_CHANNEL,
        username: process.env.SLACK_BOT_NAME,
        text: "Would you like to open the navigator?",
        attachments: [
            {
                title: "Go Home 🏠",
                title_link: "YOUR_GOOGLE_MAPS_LINK_TO_HOME_DESTINATION"
            },
            {
                title: "Go Work 🏢",
                title_link: "YOUR_GOOGLE_MAPS_LINK_TO_WORK_DESTINATION"
            }
        ]
    }    

    return payload;
    
}

function formatNewsInfo(msg, now) {
    
    var payload = {
        channel: process.env.SLACK_CHANNEL,
        username: process.env.SLACK_BOT_NAME,
        text: "News for the <!date^"+now+"^{date_pretty} at {time}|at "+now+" AM> ",
        attachments: [{
        }]
    };
        
    msg['articles'].forEach(function(item, index) {
        if (index < process.env.MAX_NEWS_SHOWN) {
            var attachments = {
                color: "#36a64f",
                fallback: item['title'],
                pretext: item['description'],
                author_name: item['author'],
                author_link: item['url'],
                author_icon: item['urlToImage'],
                title: item['title'],
                title_link: item['url'],
                image_url: item['urlToImage'],
                thumb_url: item['urlToImage'],
                footer_icon: item['urlToImage'],
                ts: item['publishedAt']
            };
            payload['attachments'].push(attachments);
        }
    });
    
    return payload;
    
}

function weather(now) {

    let apiKey = process.env.WEATHER_API;
    let city = process.env.WEATHER_CITY;
    let url = `http://api.openweathermap.org/data/2.5/forecast?q=${city}&units=metric&appid=${apiKey}`;
    console.log(url);
    let message = 'I can\'t see outside 🧐';
    
    request(url, function (err, response, body) {
        if(err){
            console.log('error:', err);
            slack(slackSimple(message));
        } else {
            console.log(body);
            let weather = JSON.parse(body);
            //http://openweathermap.org/img/w/10d.png
            slack(formatWeatherInfo(weather, now));
        }
    });

}

function traffic(now) {
    slack(formatTrafficInfo(now));
}

function news(now) {

    var params = {
        FunctionName: 'BreakingNews', // the lambda function we are going to invoke
        InvocationType: 'RequestResponse',
        LogType: 'Tail',
        Payload: '{}'
    };

    lambda.invoke(params, function(err, data) {
        if (err) {
            console.log(err);
            slack(slackSimple(err));
        } else {
            console.log(data.Payload);
            slack(formatNewsInfo(JSON.parse(data.Payload), now));
        }
    });

}

var actions = {
    
    "1" : weather,
    "2" : traffic,
    "3" : news

};

function increment(data, now) {
    if (data['count'] >= Object.keys(actions).length) {
        data['count'] = 1;
        console.log("Restart (new val: "+data['count']+")");
    } else {
        data['count'] += 1;
        console.log("Increment (new val: "+data['count']+")");
    }
    data['timestamp'] = now;
    return data;
}

function execute(data, now) {
    console.log("Execute action "+data['count']);
    data['count'] = 0;
    data['timestamp'] = now;
    return data;
}

function reset(data, now) {
    console.log("Reset and restart count!");
    data['count'] = 1;
    data['timestamp'] = now;
    return data;
}

exports.handler = (event, context, callback) => {

    var reqdate = new Date();
    reqdate.setHours(reqdate.getHours() + 1);
    var now = Math.round(reqdate.getTime()/1000);
    
    var params = {
        Key: {
            "id": 1
        },
        TableName: process.env.EVENTS_TABLE
    };

    docClient.get(params, function(err, item) {
        if (err) {

            console.log(err, err.stack); // an error occurred

        } else {
            
            var data = item["Item"];

            console.log(data);                      // successful response
            console.log(now, data['timestamp'], (now - data['timestamp']));
            if ((now - data['timestamp']) < process.env.COUNTER_LIMIT) {
                data = increment(data, now);
            }
            if ((now - data['timestamp']) >= process.env.COUNTER_LIMIT && (now - data['timestamp']) < process.env.UPPER_LIMIT) {
                if (data['count'] == 0) {
                    data = reset(data, now);
                } else {
                    actions[data['count']](now);
                    data = execute(data, now);
                }
            }
            if ((now - data['timestamp']) >= process.env.UPPER_LIMIT) {
                data = reset(data, now);
            }
            console.log(data);
            params = {
                TableName: process.env.EVENTS_TABLE,
                Item: data
            };
            docClient.put(params, function(err, item) {
                if (err) console.log(err, err.stack); // an error occurred
            });

        }
    });

};