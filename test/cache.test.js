'use strict';

var Promise = require('bluebird');
var redis = require('redis');

var chai = require('chai');
var chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);

chai.should();

var time   = Date.now(),
    prefix = 'cacher:test:';

var Cache = require('../lib/cache');

describe('Cache', function () {
    beforeEach(function () {
        if (process.env.REDIS_SOCK)
            this.redis = redis.createClient(config.redis.socket);
        else if (!isNaN(+process.env.REDIS_PORT) && process.env.REDIS_HOST)
            this.redis = redis.createClient(+process.env.REDIS_PORT, process.env.REDIS_HOST);
        else
            this.redis = redis.createClient();

        this.cache = Cache({ redis: this.redis, prefix: prefix });
    });

    describe('#fetch()', function () {
        beforeEach(function (done) {
            this.redis.multi()
                .hmset(prefix + 'cached_item',
                'value', 'simple',
                'updated', time)
                .hmset(prefix + '123',
                'value', 'simple',
                'updated', time)
                .del(prefix + 'another_item')
                .exec(done);
        });

        it('should be rejected if no parameters passed', function () {
            return this.cache.fetch().should.eventually.be.rejectedWith(TypeError);
        });

        describe('value key handling', function () {
            it('should handle string value for options and treat is as cache value key', function () {
                return this.cache.fetch('cached_item').should.eventually.equal('simple');
            });

            it('should handle numeric value for options and treat is as cache value key', function () {
                return this.cache.fetch(123).should.eventually.equal('simple');
            });

            it('should handle object', function () {
                return this.cache.fetch({ title: 'cached_item' }).should.eventually.equal('simple');
            });

            it('should be rejected with error when options is invalid', function () {
                return this.cache.fetch(new Date()).should.eventually.be.rejectedWith(TypeError);
            });
        });

        it('should return `null` if no such item in cache and calculation function was not provided', function () {
            return this.cache.fetch('random_item').should.eventually.be.null;
        });

        it('should cache function call result if no value in cache', function () {
            return this.cache.fetch('another_item', function (cb) {
                cb(null, 666);
            }).should.eventually.equal(666);
        });

        it('should be rejected if function call return error', function () {
            return this.cache.fetch('another_item', function (cb) {
                cb(new Error('Unable to do calculation'));
            }).should.eventually.be.rejected;
        });

        describe('cache item expiration', function () {
            beforeEach(function (done) {
                this.redis.multi()
                    .del(prefix + 'another_item')
                    .del(prefix + 'cached_item')
                    .exec(done);
            });

            it('should follow `expires` option', function () {
                this.timeout(6000);

                return Promise.all([
                    this.cache.fetch({ title: 'cached_item', expires: 1 },
                        function (cb) {
                            cb(null, 777);
                        })
                        .delay(1500)
                        .then(function () {
                            return this.cache.fetch('cached_item');
                        }.bind(this)).should.eventually.be.null,
                    this.cache.fetch({ title: 'another_item', expires: 2 },
                        function (cb) {
                            cb(null, 888);
                        })
                        .then(function () {
                            return this.cache.fetch('another_item').should.eventually.equal(888);
                        }.bind(this))
                        .delay(3000)
                        .then(function () {
                            return this.cache.fetch('another_item');
                        }.bind(this)).should.eventually.be.null
                ]);
            });

            it('should overwrite `expires` value if it is different from previously set');
            it('should overwrite `expires` value if provided expiration time is less than it was previously specified' +
               ' and it is expired according to the new');
        });

        describe('key parameters', function () {
            it('should handle extra details for key in order to distinguish different values of same type',
                function () {
                    var cacheKey = 'random_item' + Math.random();

                    let map = new Map();
                    map.set('instance_1', Math.random());
                    map.set('instance_2', Math.random());
                    map.set(123, Math.random());
                    map.set({ object: 'desc' }, Math.random());

                    let promises = [];
                    for (let v of map) {
                        (function (key, value) {
                            promises.push(this.cache.fetch(cacheKey, key,
                                function (cb) {
                                    cb(null, value);
                                }));
                        }).apply(this, v);
                    }

                    return Promise.all(promises)
                        .then(function () {
                            promises = [];
                            for (let v of map) {
                                (function (key, value) {
                                    promises.push(this.cache.fetch(cacheKey, key).should.eventually.equal(value));
                                }).apply(this, v);
                            }

                            return Promise.all(promises);
                        }.bind(this));
                });

            it('should not accept anything but String, Number, plain Object as key parameters', function () {
                var cacheKey = 'random_item' + Math.random();

                var nuller = function (cb) {
                    cb(null, null);
                };

                return Promise.all([
                    this.cache.fetch(cacheKey, 'string', nuller).should.eventually.be.null,
                    this.cache.fetch(cacheKey, 123, nuller).should.eventually.be.null,
                    this.cache.fetch(cacheKey, { object: 'accepted' }, nuller).should.eventually.be.null,
                    this.cache.fetch(cacheKey, new Date(), nuller).should.eventually.be.rejectedWith(TypeError),
                    this.cache.fetch(cacheKey, null, nuller).should.eventually.be.rejectedWith(TypeError)
                ]);
            });
        });

        it('should cache plain objects and retrieve them as Javascript object', function () {
            var dataObj = { some: 'object', 'for': { testing: 123581321 } };
            return this.cache.fetch('another_item',
                function (cb) {
                    cb(null, dataObj);
                })
                .then(function () {
                    return this.cache.fetch('another_item').should.eventually.deep.equal(dataObj);
                }.bind(this));
        });

        it('should accept only function for calculation', function () {
            return this.cache.fetch('another_item', {}, 'test').should.eventually.be.rejectedWith(TypeError);
        });

        it('should pass callback function as a first argument to calculation function', function () {
            return this.cache.fetch(Math.random(), {}, function (cb) {
                cb.should.be.a('function');
                cb.length.should.be.equal(2);
                cb(null, null);
            }).should.eventually.be.null;
        });
    });
});