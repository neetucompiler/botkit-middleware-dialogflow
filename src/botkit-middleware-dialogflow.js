var debug = require('debug')('dialogflow-middleware');
var apiai = require('apiai');
var makeArrayOfRegex = require('./util').makeArrayOfRegex;
var generateSessionId = require('./util').generateSessionId;

module.exports = function(config) {
    if (!config || !config.token) {
        throw new Error('No dialogflow token provided.');
    }

    if (!config.minimum_confidence) {
        config.minimum_confidence = 0.5;
    }

    if (!config.sessionIdProps) {
        config.sessionIdProps = ['user', 'channel'];
    }

    var ignoreTypePatterns = makeArrayOfRegex(config.ignoreType || []);

    var app = apiai(config.token);

    var middleware = {};

    middleware.receive = function(bot, message, next) {
        if (!message.text || message.is_echo || message.type === 'self_message') {
            next();
            return;
        }

        for (let pattern of ignoreTypePatterns) {
            if (pattern.test(message.type)) {
                debug('skipping call to Dialogflow since type matched ', pattern);
                next();
                return;
            }
        }

        if (message.lang) {
            app.language = message.lang;
        } else {
            app.language = 'en';
        }

        var requestSessionId = generateSessionId(config, message);

        debug(
            'Sending message to dialogflow. sessionId=%s, language=%s, text=%s',
            requestSessionId,
            app.language,
            message.text
        );
        request = app.textRequest(message.text, {
            sessionId: requestSessionId,
        });

        request.on('response', function(response) {
            message.intent = response.result.metadata.intentName;
            message.entities = response.result.parameters;
            message.fulfillment = response.result.fulfillment;
            message.confidence = response.result.score;
            message.nlpResponse = response;
            debug('dialogflow annotated message: %O', message);
            next();
        });

        request.on('error', function(error) {
            debug('dialogflow returned error', error);
            next(error);
        });

        request.end();
    };

    middleware.hears = function(patterns, message) {
        var regexPatterns = makeArrayOfRegex(patterns);

        for (let pattern of regexPatterns) {
            if (pattern.test(message.intent) && message.confidence >= config.minimum_confidence) {
                debug('dialogflow intent matched hear pattern', message.intent, pattern);
                return true;
            }
        }

        return false;
    };

    middleware.action = function(patterns, message) {
        var regexPatterns = makeArrayOfRegex(patterns);

        for (let pattern of regexPatterns) {
            if (pattern.test(message.nlpResponse.result.action) && message.confidence >= config.minimum_confidence) {
                debug('dialogflow action matched hear pattern', message.intent, pattern);
                return true;
            }
        }

        return false;
    };

    return middleware;
};
