'use strict';

var _           = require('lodash'),
    debug       = require('debug')('redis-cacher'),
    RedisClient = require('redis').RedisClient,
    Promise     = require('bluebird');

/**
 *
 * @param {Object} config
 * @param [config.redis] Redis connection to be used for storing session data
 *                        (uses default localhost:6379 if not specified)
 *                        ---OR---
 *                        object with configuration that will be passed when creating Redis connection
 *
 * @returns {Object}
 */
module.exports = function cache (config) {
    if (_.isPlainObject(config)) {
        if (_.has(config, 'redis')) {
            if (!(config.redis instanceof RedisClient)) {
                if (!_.isPlainObject(config.redis))
                    throw new TypeError('redis property should be a Redis client');

                let redisArgs = [];

                if (config.redis.socket)
                    redisArgs.push(config.redis.socket);
                else if (!isNaN(+config.redis.port) && config.redis.host)
                    redisArgs.push(+config.redis.port, config.redis.host);

                if (_.isPlainObject(config.redis.options))
                    redisArgs.push(config.redis.options);

                config.redis = _.spread(require('redis').createClient)(redisArgs);
            }
        } else
            config.redis = require('redis').createClient();
    }

    config = _.defaults(config, {
        expires: 300,
        prefix:  'cacher:'
    });

    function fetch (a, b, c) {
        var defaults = {
            expires: config.expires
        }, args      = arguments.length;

        return new Promise(function (resolve, reject) {
            var options = a, sub, calc;

            switch (args) {
                case 0:
                    return reject(new TypeError('At least cache element name should be passed as a parameter'));

                case 2:
                    options = a;
                    if (_.isFunction(b))
                        calc = b;
                    else
                        sub = b;
                    break;

                case 3:
                    sub = b;
                    calc = c;
                    break;
            }

            if (_.isUndefined(calc)) {
                calc = function (cb) {
                    debug('Running fallback calc function that returns null');
                    cb(null, null);
                };
            } else if (!_.isFunction(calc)) {
                return reject(new TypeError('Callback should be a function that returns value to store in cache'));
            }

            if (_.isPlainObject(options))
                options = _.defaults({}, options, defaults);
            else if (_.isString(options) || (_.isNumber(options) && !_.isNaN(options)))
                options = { title: String(options) };
            else
                return reject(new TypeError('Either object or key of value in cache should be passed as an argument'));

            if (!options.hasOwnProperty('title') || !_.isString(options.title))
                return reject(new TypeError('Key should string value'));

            options.title = config.prefix + options.title;

            if (!_.isUndefined(sub)) {
                if (_.isString(sub) || _.isNumber(sub))
                    options.title += sub;
                else if (_.isPlainObject(sub))
                    options.title += JSON.stringify(sub);
                else
                    return reject(new TypeError('Key sub-information should be either a string, or a number or a plain object'));

                // todo handle functions
            }

            function calculate () {
                debug('Calculating value of `' + options.title + '`');
                calc(function (err, data) {
                    if (err) {
                        debug('Unable to calculate value for `' + options.title + '`', err);
                        return reject(err);
                    }

                    resolve(data);

                    config.redis.multi()
                        .hmset(options.title, 'value', JSON.stringify(data), 'updated', Date.now())
                        .expire(options.title, options.expires)
                        .exec(function (err) {
                            if (err)
                                console.error('Unable to save `' + options.title + '` value to cache', err);
                        });
                });
            }

            config.redis.hget(options.title, 'value', function (err, value) {
                if (err) {
                    debug('Unable to retrieve value from cache', err);
                    return calculate();
                }

                if (value === 'null' || value === null) {
                    debug('No value in cache');
                    return calculate();
                }

                debug('Attempting to parse JSON');

                try {
                    resolve(JSON.parse(value));
                } catch (e) {
                    resolve(value);
                }
            });
        });
    }

    return {
        fetch: fetch
    };
};