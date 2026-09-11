/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import $protobuf from "protobufjs/minimal.js";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const ovlive = $root.ovlive = (() => {

    /**
     * Namespace ovlive.
     * @exports ovlive
     * @namespace
     */
    const ovlive = {};

    ovlive.v1 = (function() {

        /**
         * Namespace v1.
         * @memberof ovlive
         * @namespace
         */
        const v1 = {};

        /**
         * VehicleType enum.
         * @name ovlive.v1.VehicleType
         * @enum {number}
         * @property {number} VEHICLE_TYPE_UNSPECIFIED=0 VEHICLE_TYPE_UNSPECIFIED value
         * @property {number} BUS=1 BUS value
         * @property {number} TRAM=2 TRAM value
         * @property {number} METRO=3 METRO value
         * @property {number} TRAIN=4 TRAIN value
         * @property {number} FERRY=5 FERRY value
         */
        v1.VehicleType = (function() {
            const valuesById = {}, values = Object.create(valuesById);
            values[valuesById[0] = "VEHICLE_TYPE_UNSPECIFIED"] = 0;
            values[valuesById[1] = "BUS"] = 1;
            values[valuesById[2] = "TRAM"] = 2;
            values[valuesById[3] = "METRO"] = 3;
            values[valuesById[4] = "TRAIN"] = 4;
            values[valuesById[5] = "FERRY"] = 5;
            return values;
        })();

        v1.Viewport = (function() {

            /**
             * Properties of a Viewport.
             * @memberof ovlive.v1
             * @interface IViewport
             * @property {number|null} [min_lat] Viewport min_lat
             * @property {number|null} [min_lon] Viewport min_lon
             * @property {number|null} [max_lat] Viewport max_lat
             * @property {number|null} [max_lon] Viewport max_lon
             * @property {number|null} [zoom] Viewport zoom
             */

            /**
             * Constructs a new Viewport.
             * @memberof ovlive.v1
             * @classdesc Represents a Viewport.
             * @implements IViewport
             * @constructor
             * @param {ovlive.v1.IViewport=} [properties] Properties to set
             */
            function Viewport(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Viewport min_lat.
             * @member {number} min_lat
             * @memberof ovlive.v1.Viewport
             * @instance
             */
            Viewport.prototype.min_lat = 0;

            /**
             * Viewport min_lon.
             * @member {number} min_lon
             * @memberof ovlive.v1.Viewport
             * @instance
             */
            Viewport.prototype.min_lon = 0;

            /**
             * Viewport max_lat.
             * @member {number} max_lat
             * @memberof ovlive.v1.Viewport
             * @instance
             */
            Viewport.prototype.max_lat = 0;

            /**
             * Viewport max_lon.
             * @member {number} max_lon
             * @memberof ovlive.v1.Viewport
             * @instance
             */
            Viewport.prototype.max_lon = 0;

            /**
             * Viewport zoom.
             * @member {number} zoom
             * @memberof ovlive.v1.Viewport
             * @instance
             */
            Viewport.prototype.zoom = 0;

            /**
             * Encodes the specified Viewport message. Does not implicitly {@link ovlive.v1.Viewport.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.Viewport
             * @static
             * @param {ovlive.v1.IViewport} message Viewport message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Viewport.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.min_lat != null && Object.hasOwnProperty.call(message, "min_lat"))
                    writer.uint32(/* id 1, wireType 1 =*/9).double(message.min_lat);
                if (message.min_lon != null && Object.hasOwnProperty.call(message, "min_lon"))
                    writer.uint32(/* id 2, wireType 1 =*/17).double(message.min_lon);
                if (message.max_lat != null && Object.hasOwnProperty.call(message, "max_lat"))
                    writer.uint32(/* id 3, wireType 1 =*/25).double(message.max_lat);
                if (message.max_lon != null && Object.hasOwnProperty.call(message, "max_lon"))
                    writer.uint32(/* id 4, wireType 1 =*/33).double(message.max_lon);
                if (message.zoom != null && Object.hasOwnProperty.call(message, "zoom"))
                    writer.uint32(/* id 5, wireType 0 =*/40).uint32(message.zoom);
                return writer;
            };

            /**
             * Decodes a Viewport message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.Viewport
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.Viewport} Viewport
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Viewport.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.Viewport();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.min_lat = reader.double();
                            break;
                        }
                    case 2: {
                            message.min_lon = reader.double();
                            break;
                        }
                    case 3: {
                            message.max_lat = reader.double();
                            break;
                        }
                    case 4: {
                            message.max_lon = reader.double();
                            break;
                        }
                    case 5: {
                            message.zoom = reader.uint32();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a Viewport message.
             * @function verify
             * @memberof ovlive.v1.Viewport
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Viewport.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.min_lat != null && Object.hasOwnProperty.call(message, "min_lat"))
                    if (typeof message.min_lat !== "number")
                        return "min_lat: number expected";
                if (message.min_lon != null && Object.hasOwnProperty.call(message, "min_lon"))
                    if (typeof message.min_lon !== "number")
                        return "min_lon: number expected";
                if (message.max_lat != null && Object.hasOwnProperty.call(message, "max_lat"))
                    if (typeof message.max_lat !== "number")
                        return "max_lat: number expected";
                if (message.max_lon != null && Object.hasOwnProperty.call(message, "max_lon"))
                    if (typeof message.max_lon !== "number")
                        return "max_lon: number expected";
                if (message.zoom != null && Object.hasOwnProperty.call(message, "zoom"))
                    if (!$util.isInteger(message.zoom))
                        return "zoom: integer expected";
                return null;
            };

            /**
             * Creates a Viewport message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.Viewport
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.Viewport} Viewport
             */
            Viewport.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.Viewport)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.Viewport: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.Viewport();
                if (object.min_lat != null)
                    message.min_lat = Number(object.min_lat);
                if (object.min_lon != null)
                    message.min_lon = Number(object.min_lon);
                if (object.max_lat != null)
                    message.max_lat = Number(object.max_lat);
                if (object.max_lon != null)
                    message.max_lon = Number(object.max_lon);
                if (object.zoom != null)
                    message.zoom = object.zoom >>> 0;
                return message;
            };

            /**
             * Creates a plain object from a Viewport message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.Viewport
             * @static
             * @param {ovlive.v1.Viewport} message Viewport
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Viewport.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.min_lat = 0;
                    object.min_lon = 0;
                    object.max_lat = 0;
                    object.max_lon = 0;
                    object.zoom = 0;
                }
                if (message.min_lat != null && Object.hasOwnProperty.call(message, "min_lat"))
                    object.min_lat = options.json && !isFinite(message.min_lat) ? String(message.min_lat) : message.min_lat;
                if (message.min_lon != null && Object.hasOwnProperty.call(message, "min_lon"))
                    object.min_lon = options.json && !isFinite(message.min_lon) ? String(message.min_lon) : message.min_lon;
                if (message.max_lat != null && Object.hasOwnProperty.call(message, "max_lat"))
                    object.max_lat = options.json && !isFinite(message.max_lat) ? String(message.max_lat) : message.max_lat;
                if (message.max_lon != null && Object.hasOwnProperty.call(message, "max_lon"))
                    object.max_lon = options.json && !isFinite(message.max_lon) ? String(message.max_lon) : message.max_lon;
                if (message.zoom != null && Object.hasOwnProperty.call(message, "zoom"))
                    object.zoom = message.zoom;
                return object;
            };

            /**
             * Converts this Viewport to JSON.
             * @function toJSON
             * @memberof ovlive.v1.Viewport
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Viewport.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Viewport
             * @function getTypeUrl
             * @memberof ovlive.v1.Viewport
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Viewport.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.Viewport";
            };

            return Viewport;
        })();

        v1.Filters = (function() {

            /**
             * Properties of a Filters.
             * @memberof ovlive.v1
             * @interface IFilters
             * @property {Array.<ovlive.v1.VehicleType>|null} [vehicle_types] Filters vehicle_types
             * @property {Array.<string>|null} [dataowners] Filters dataowners
             * @property {string|null} [search] Filters search
             */

            /**
             * Constructs a new Filters.
             * @memberof ovlive.v1
             * @classdesc Represents a Filters.
             * @implements IFilters
             * @constructor
             * @param {ovlive.v1.IFilters=} [properties] Properties to set
             */
            function Filters(properties) {
                this.vehicle_types = [];
                this.dataowners = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Filters vehicle_types.
             * @member {Array.<ovlive.v1.VehicleType>} vehicle_types
             * @memberof ovlive.v1.Filters
             * @instance
             */
            Filters.prototype.vehicle_types = $util.emptyArray;

            /**
             * Filters dataowners.
             * @member {Array.<string>} dataowners
             * @memberof ovlive.v1.Filters
             * @instance
             */
            Filters.prototype.dataowners = $util.emptyArray;

            /**
             * Filters search.
             * @member {string} search
             * @memberof ovlive.v1.Filters
             * @instance
             */
            Filters.prototype.search = "";

            /**
             * Encodes the specified Filters message. Does not implicitly {@link ovlive.v1.Filters.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.Filters
             * @static
             * @param {ovlive.v1.IFilters} message Filters message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Filters.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.vehicle_types != null && message.vehicle_types.length) {
                    writer.uint32(/* id 1, wireType 2 =*/10).fork();
                    for (let i = 0; i < message.vehicle_types.length; ++i)
                        writer.int32(message.vehicle_types[i]);
                    writer.ldelim();
                }
                if (message.dataowners != null && message.dataowners.length)
                    for (let i = 0; i < message.dataowners.length; ++i)
                        writer.uint32(/* id 2, wireType 2 =*/18).string(message.dataowners[i]);
                if (message.search != null && Object.hasOwnProperty.call(message, "search"))
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.search);
                return writer;
            };

            /**
             * Decodes a Filters message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.Filters
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.Filters} Filters
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Filters.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.Filters();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            if (!(message.vehicle_types && message.vehicle_types.length))
                                message.vehicle_types = [];
                            if ((tag & 7) === 2) {
                                let end2 = reader.uint32() + reader.pos;
                                while (reader.pos < end2)
                                    message.vehicle_types.push(reader.int32());
                            } else
                                message.vehicle_types.push(reader.int32());
                            break;
                        }
                    case 2: {
                            if (!(message.dataowners && message.dataowners.length))
                                message.dataowners = [];
                            message.dataowners.push(reader.string());
                            break;
                        }
                    case 3: {
                            message.search = reader.string();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a Filters message.
             * @function verify
             * @memberof ovlive.v1.Filters
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Filters.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.vehicle_types != null && Object.hasOwnProperty.call(message, "vehicle_types")) {
                    if (!Array.isArray(message.vehicle_types))
                        return "vehicle_types: array expected";
                    for (let i = 0; i < message.vehicle_types.length; ++i)
                        switch (message.vehicle_types[i]) {
                        default:
                            return "vehicle_types: enum value[] expected";
                        case 0:
                        case 1:
                        case 2:
                        case 3:
                        case 4:
                        case 5:
                            break;
                        }
                }
                if (message.dataowners != null && Object.hasOwnProperty.call(message, "dataowners")) {
                    if (!Array.isArray(message.dataowners))
                        return "dataowners: array expected";
                    for (let i = 0; i < message.dataowners.length; ++i)
                        if (!$util.isString(message.dataowners[i]))
                            return "dataowners: string[] expected";
                }
                if (message.search != null && Object.hasOwnProperty.call(message, "search"))
                    if (!$util.isString(message.search))
                        return "search: string expected";
                return null;
            };

            /**
             * Creates a Filters message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.Filters
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.Filters} Filters
             */
            Filters.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.Filters)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.Filters: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.Filters();
                if (object.vehicle_types) {
                    if (!Array.isArray(object.vehicle_types))
                        throw TypeError(".ovlive.v1.Filters.vehicle_types: array expected");
                    message.vehicle_types = [];
                    for (let i = 0; i < object.vehicle_types.length; ++i)
                        switch (object.vehicle_types[i]) {
                        default:
                            if (typeof object.vehicle_types[i] === "number") {
                                message.vehicle_types[i] = object.vehicle_types[i];
                                break;
                            }
                        case "VEHICLE_TYPE_UNSPECIFIED":
                        case 0:
                            message.vehicle_types[i] = 0;
                            break;
                        case "BUS":
                        case 1:
                            message.vehicle_types[i] = 1;
                            break;
                        case "TRAM":
                        case 2:
                            message.vehicle_types[i] = 2;
                            break;
                        case "METRO":
                        case 3:
                            message.vehicle_types[i] = 3;
                            break;
                        case "TRAIN":
                        case 4:
                            message.vehicle_types[i] = 4;
                            break;
                        case "FERRY":
                        case 5:
                            message.vehicle_types[i] = 5;
                            break;
                        }
                }
                if (object.dataowners) {
                    if (!Array.isArray(object.dataowners))
                        throw TypeError(".ovlive.v1.Filters.dataowners: array expected");
                    message.dataowners = [];
                    for (let i = 0; i < object.dataowners.length; ++i)
                        message.dataowners[i] = String(object.dataowners[i]);
                }
                if (object.search != null)
                    message.search = String(object.search);
                return message;
            };

            /**
             * Creates a plain object from a Filters message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.Filters
             * @static
             * @param {ovlive.v1.Filters} message Filters
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Filters.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.arrays || options.defaults) {
                    object.vehicle_types = [];
                    object.dataowners = [];
                }
                if (options.defaults)
                    object.search = "";
                if (message.vehicle_types && message.vehicle_types.length) {
                    object.vehicle_types = [];
                    for (let j = 0; j < message.vehicle_types.length; ++j)
                        object.vehicle_types[j] = options.enums === String ? $root.ovlive.v1.VehicleType[message.vehicle_types[j]] === undefined ? message.vehicle_types[j] : $root.ovlive.v1.VehicleType[message.vehicle_types[j]] : message.vehicle_types[j];
                }
                if (message.dataowners && message.dataowners.length) {
                    object.dataowners = [];
                    for (let j = 0; j < message.dataowners.length; ++j)
                        object.dataowners[j] = message.dataowners[j];
                }
                if (message.search != null && Object.hasOwnProperty.call(message, "search"))
                    object.search = message.search;
                return object;
            };

            /**
             * Converts this Filters to JSON.
             * @function toJSON
             * @memberof ovlive.v1.Filters
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Filters.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Filters
             * @function getTypeUrl
             * @memberof ovlive.v1.Filters
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Filters.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.Filters";
            };

            return Filters;
        })();

        v1.Subscribe = (function() {

            /**
             * Properties of a Subscribe.
             * @memberof ovlive.v1
             * @interface ISubscribe
             * @property {ovlive.v1.IViewport|null} [viewport] Subscribe viewport
             * @property {ovlive.v1.IFilters|null} [filters] Subscribe filters
             * @property {Array.<string>|null} [pinned] Subscribe pinned
             */

            /**
             * Constructs a new Subscribe.
             * @memberof ovlive.v1
             * @classdesc Represents a Subscribe.
             * @implements ISubscribe
             * @constructor
             * @param {ovlive.v1.ISubscribe=} [properties] Properties to set
             */
            function Subscribe(properties) {
                this.pinned = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Subscribe viewport.
             * @member {ovlive.v1.IViewport|null|undefined} viewport
             * @memberof ovlive.v1.Subscribe
             * @instance
             */
            Subscribe.prototype.viewport = null;

            /**
             * Subscribe filters.
             * @member {ovlive.v1.IFilters|null|undefined} filters
             * @memberof ovlive.v1.Subscribe
             * @instance
             */
            Subscribe.prototype.filters = null;

            /**
             * Subscribe pinned.
             * @member {Array.<string>} pinned
             * @memberof ovlive.v1.Subscribe
             * @instance
             */
            Subscribe.prototype.pinned = $util.emptyArray;

            /**
             * Encodes the specified Subscribe message. Does not implicitly {@link ovlive.v1.Subscribe.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.Subscribe
             * @static
             * @param {ovlive.v1.ISubscribe} message Subscribe message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Subscribe.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.viewport != null && Object.hasOwnProperty.call(message, "viewport"))
                    $root.ovlive.v1.Viewport.encode(message.viewport, writer.uint32(/* id 1, wireType 2 =*/10).fork(), q + 1).ldelim();
                if (message.filters != null && Object.hasOwnProperty.call(message, "filters"))
                    $root.ovlive.v1.Filters.encode(message.filters, writer.uint32(/* id 2, wireType 2 =*/18).fork(), q + 1).ldelim();
                if (message.pinned != null && message.pinned.length)
                    for (let i = 0; i < message.pinned.length; ++i)
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.pinned[i]);
                return writer;
            };

            /**
             * Decodes a Subscribe message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.Subscribe
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.Subscribe} Subscribe
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Subscribe.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.Subscribe();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.viewport = $root.ovlive.v1.Viewport.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    case 2: {
                            message.filters = $root.ovlive.v1.Filters.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    case 3: {
                            if (!(message.pinned && message.pinned.length))
                                message.pinned = [];
                            message.pinned.push(reader.string());
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a Subscribe message.
             * @function verify
             * @memberof ovlive.v1.Subscribe
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Subscribe.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.viewport != null && Object.hasOwnProperty.call(message, "viewport")) {
                    let error = $root.ovlive.v1.Viewport.verify(message.viewport, long + 1);
                    if (error)
                        return "viewport." + error;
                }
                if (message.filters != null && Object.hasOwnProperty.call(message, "filters")) {
                    let error = $root.ovlive.v1.Filters.verify(message.filters, long + 1);
                    if (error)
                        return "filters." + error;
                }
                if (message.pinned != null && Object.hasOwnProperty.call(message, "pinned")) {
                    if (!Array.isArray(message.pinned))
                        return "pinned: array expected";
                    for (let i = 0; i < message.pinned.length; ++i)
                        if (!$util.isString(message.pinned[i]))
                            return "pinned: string[] expected";
                }
                return null;
            };

            /**
             * Creates a Subscribe message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.Subscribe
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.Subscribe} Subscribe
             */
            Subscribe.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.Subscribe)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.Subscribe: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.Subscribe();
                if (object.viewport != null) {
                    if (!$util.isObject(object.viewport))
                        throw TypeError(".ovlive.v1.Subscribe.viewport: object expected");
                    message.viewport = $root.ovlive.v1.Viewport.fromObject(object.viewport, long + 1);
                }
                if (object.filters != null) {
                    if (!$util.isObject(object.filters))
                        throw TypeError(".ovlive.v1.Subscribe.filters: object expected");
                    message.filters = $root.ovlive.v1.Filters.fromObject(object.filters, long + 1);
                }
                if (object.pinned) {
                    if (!Array.isArray(object.pinned))
                        throw TypeError(".ovlive.v1.Subscribe.pinned: array expected");
                    message.pinned = [];
                    for (let i = 0; i < object.pinned.length; ++i)
                        message.pinned[i] = String(object.pinned[i]);
                }
                return message;
            };

            /**
             * Creates a plain object from a Subscribe message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.Subscribe
             * @static
             * @param {ovlive.v1.Subscribe} message Subscribe
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Subscribe.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.arrays || options.defaults)
                    object.pinned = [];
                if (options.defaults) {
                    object.viewport = null;
                    object.filters = null;
                }
                if (message.viewport != null && Object.hasOwnProperty.call(message, "viewport"))
                    object.viewport = $root.ovlive.v1.Viewport.toObject(message.viewport, options, q + 1);
                if (message.filters != null && Object.hasOwnProperty.call(message, "filters"))
                    object.filters = $root.ovlive.v1.Filters.toObject(message.filters, options, q + 1);
                if (message.pinned && message.pinned.length) {
                    object.pinned = [];
                    for (let j = 0; j < message.pinned.length; ++j)
                        object.pinned[j] = message.pinned[j];
                }
                return object;
            };

            /**
             * Converts this Subscribe to JSON.
             * @function toJSON
             * @memberof ovlive.v1.Subscribe
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Subscribe.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Subscribe
             * @function getTypeUrl
             * @memberof ovlive.v1.Subscribe
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Subscribe.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.Subscribe";
            };

            return Subscribe;
        })();

        v1.UpdateViewport = (function() {

            /**
             * Properties of an UpdateViewport.
             * @memberof ovlive.v1
             * @interface IUpdateViewport
             * @property {ovlive.v1.IViewport|null} [viewport] UpdateViewport viewport
             * @property {ovlive.v1.IFilters|null} [filters] UpdateViewport filters
             * @property {Array.<string>|null} [pinned] UpdateViewport pinned
             */

            /**
             * Constructs a new UpdateViewport.
             * @memberof ovlive.v1
             * @classdesc Represents an UpdateViewport.
             * @implements IUpdateViewport
             * @constructor
             * @param {ovlive.v1.IUpdateViewport=} [properties] Properties to set
             */
            function UpdateViewport(properties) {
                this.pinned = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * UpdateViewport viewport.
             * @member {ovlive.v1.IViewport|null|undefined} viewport
             * @memberof ovlive.v1.UpdateViewport
             * @instance
             */
            UpdateViewport.prototype.viewport = null;

            /**
             * UpdateViewport filters.
             * @member {ovlive.v1.IFilters|null|undefined} filters
             * @memberof ovlive.v1.UpdateViewport
             * @instance
             */
            UpdateViewport.prototype.filters = null;

            /**
             * UpdateViewport pinned.
             * @member {Array.<string>} pinned
             * @memberof ovlive.v1.UpdateViewport
             * @instance
             */
            UpdateViewport.prototype.pinned = $util.emptyArray;

            /**
             * Encodes the specified UpdateViewport message. Does not implicitly {@link ovlive.v1.UpdateViewport.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.UpdateViewport
             * @static
             * @param {ovlive.v1.IUpdateViewport} message UpdateViewport message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            UpdateViewport.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.viewport != null && Object.hasOwnProperty.call(message, "viewport"))
                    $root.ovlive.v1.Viewport.encode(message.viewport, writer.uint32(/* id 1, wireType 2 =*/10).fork(), q + 1).ldelim();
                if (message.filters != null && Object.hasOwnProperty.call(message, "filters"))
                    $root.ovlive.v1.Filters.encode(message.filters, writer.uint32(/* id 2, wireType 2 =*/18).fork(), q + 1).ldelim();
                if (message.pinned != null && message.pinned.length)
                    for (let i = 0; i < message.pinned.length; ++i)
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.pinned[i]);
                return writer;
            };

            /**
             * Decodes an UpdateViewport message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.UpdateViewport
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.UpdateViewport} UpdateViewport
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            UpdateViewport.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.UpdateViewport();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.viewport = $root.ovlive.v1.Viewport.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    case 2: {
                            message.filters = $root.ovlive.v1.Filters.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    case 3: {
                            if (!(message.pinned && message.pinned.length))
                                message.pinned = [];
                            message.pinned.push(reader.string());
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies an UpdateViewport message.
             * @function verify
             * @memberof ovlive.v1.UpdateViewport
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            UpdateViewport.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.viewport != null && Object.hasOwnProperty.call(message, "viewport")) {
                    let error = $root.ovlive.v1.Viewport.verify(message.viewport, long + 1);
                    if (error)
                        return "viewport." + error;
                }
                if (message.filters != null && Object.hasOwnProperty.call(message, "filters")) {
                    let error = $root.ovlive.v1.Filters.verify(message.filters, long + 1);
                    if (error)
                        return "filters." + error;
                }
                if (message.pinned != null && Object.hasOwnProperty.call(message, "pinned")) {
                    if (!Array.isArray(message.pinned))
                        return "pinned: array expected";
                    for (let i = 0; i < message.pinned.length; ++i)
                        if (!$util.isString(message.pinned[i]))
                            return "pinned: string[] expected";
                }
                return null;
            };

            /**
             * Creates an UpdateViewport message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.UpdateViewport
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.UpdateViewport} UpdateViewport
             */
            UpdateViewport.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.UpdateViewport)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.UpdateViewport: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.UpdateViewport();
                if (object.viewport != null) {
                    if (!$util.isObject(object.viewport))
                        throw TypeError(".ovlive.v1.UpdateViewport.viewport: object expected");
                    message.viewport = $root.ovlive.v1.Viewport.fromObject(object.viewport, long + 1);
                }
                if (object.filters != null) {
                    if (!$util.isObject(object.filters))
                        throw TypeError(".ovlive.v1.UpdateViewport.filters: object expected");
                    message.filters = $root.ovlive.v1.Filters.fromObject(object.filters, long + 1);
                }
                if (object.pinned) {
                    if (!Array.isArray(object.pinned))
                        throw TypeError(".ovlive.v1.UpdateViewport.pinned: array expected");
                    message.pinned = [];
                    for (let i = 0; i < object.pinned.length; ++i)
                        message.pinned[i] = String(object.pinned[i]);
                }
                return message;
            };

            /**
             * Creates a plain object from an UpdateViewport message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.UpdateViewport
             * @static
             * @param {ovlive.v1.UpdateViewport} message UpdateViewport
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            UpdateViewport.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.arrays || options.defaults)
                    object.pinned = [];
                if (options.defaults) {
                    object.viewport = null;
                    object.filters = null;
                }
                if (message.viewport != null && Object.hasOwnProperty.call(message, "viewport"))
                    object.viewport = $root.ovlive.v1.Viewport.toObject(message.viewport, options, q + 1);
                if (message.filters != null && Object.hasOwnProperty.call(message, "filters"))
                    object.filters = $root.ovlive.v1.Filters.toObject(message.filters, options, q + 1);
                if (message.pinned && message.pinned.length) {
                    object.pinned = [];
                    for (let j = 0; j < message.pinned.length; ++j)
                        object.pinned[j] = message.pinned[j];
                }
                return object;
            };

            /**
             * Converts this UpdateViewport to JSON.
             * @function toJSON
             * @memberof ovlive.v1.UpdateViewport
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            UpdateViewport.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for UpdateViewport
             * @function getTypeUrl
             * @memberof ovlive.v1.UpdateViewport
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            UpdateViewport.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.UpdateViewport";
            };

            return UpdateViewport;
        })();

        v1.ClientMessage = (function() {

            /**
             * Properties of a ClientMessage.
             * @memberof ovlive.v1
             * @interface IClientMessage
             * @property {ovlive.v1.ISubscribe|null} [subscribe] ClientMessage subscribe
             * @property {ovlive.v1.IUpdateViewport|null} [update_viewport] ClientMessage update_viewport
             * @property {boolean|null} [ping] ClientMessage ping
             */

            /**
             * Constructs a new ClientMessage.
             * @memberof ovlive.v1
             * @classdesc Represents a ClientMessage.
             * @implements IClientMessage
             * @constructor
             * @param {ovlive.v1.IClientMessage=} [properties] Properties to set
             */
            function ClientMessage(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * ClientMessage subscribe.
             * @member {ovlive.v1.ISubscribe|null|undefined} subscribe
             * @memberof ovlive.v1.ClientMessage
             * @instance
             */
            ClientMessage.prototype.subscribe = null;

            /**
             * ClientMessage update_viewport.
             * @member {ovlive.v1.IUpdateViewport|null|undefined} update_viewport
             * @memberof ovlive.v1.ClientMessage
             * @instance
             */
            ClientMessage.prototype.update_viewport = null;

            /**
             * ClientMessage ping.
             * @member {boolean|null|undefined} ping
             * @memberof ovlive.v1.ClientMessage
             * @instance
             */
            ClientMessage.prototype.ping = null;

            // OneOf field names bound to virtual getters and setters
            let $oneOfFields;

            /**
             * ClientMessage payload.
             * @member {"subscribe"|"update_viewport"|"ping"|undefined} payload
             * @memberof ovlive.v1.ClientMessage
             * @instance
             */
            Object.defineProperty(ClientMessage.prototype, "payload", {
                get: $util.oneOfGetter($oneOfFields = ["subscribe", "update_viewport", "ping"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            /**
             * Encodes the specified ClientMessage message. Does not implicitly {@link ovlive.v1.ClientMessage.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.ClientMessage
             * @static
             * @param {ovlive.v1.IClientMessage} message ClientMessage message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            ClientMessage.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.subscribe != null && Object.hasOwnProperty.call(message, "subscribe"))
                    $root.ovlive.v1.Subscribe.encode(message.subscribe, writer.uint32(/* id 1, wireType 2 =*/10).fork(), q + 1).ldelim();
                if (message.update_viewport != null && Object.hasOwnProperty.call(message, "update_viewport"))
                    $root.ovlive.v1.UpdateViewport.encode(message.update_viewport, writer.uint32(/* id 2, wireType 2 =*/18).fork(), q + 1).ldelim();
                if (message.ping != null && Object.hasOwnProperty.call(message, "ping"))
                    writer.uint32(/* id 3, wireType 0 =*/24).bool(message.ping);
                return writer;
            };

            /**
             * Decodes a ClientMessage message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.ClientMessage
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.ClientMessage} ClientMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            ClientMessage.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.ClientMessage();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.subscribe = $root.ovlive.v1.Subscribe.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    case 2: {
                            message.update_viewport = $root.ovlive.v1.UpdateViewport.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    case 3: {
                            message.ping = reader.bool();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a ClientMessage message.
             * @function verify
             * @memberof ovlive.v1.ClientMessage
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            ClientMessage.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                let properties = {};
                if (message.subscribe != null && Object.hasOwnProperty.call(message, "subscribe")) {
                    properties.payload = 1;
                    {
                        let error = $root.ovlive.v1.Subscribe.verify(message.subscribe, long + 1);
                        if (error)
                            return "subscribe." + error;
                    }
                }
                if (message.update_viewport != null && Object.hasOwnProperty.call(message, "update_viewport")) {
                    if (properties.payload === 1)
                        return "payload: multiple values";
                    properties.payload = 1;
                    {
                        let error = $root.ovlive.v1.UpdateViewport.verify(message.update_viewport, long + 1);
                        if (error)
                            return "update_viewport." + error;
                    }
                }
                if (message.ping != null && Object.hasOwnProperty.call(message, "ping")) {
                    if (properties.payload === 1)
                        return "payload: multiple values";
                    properties.payload = 1;
                    if (typeof message.ping !== "boolean")
                        return "ping: boolean expected";
                }
                return null;
            };

            /**
             * Creates a ClientMessage message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.ClientMessage
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.ClientMessage} ClientMessage
             */
            ClientMessage.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.ClientMessage)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.ClientMessage: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.ClientMessage();
                if (object.subscribe != null) {
                    if (!$util.isObject(object.subscribe))
                        throw TypeError(".ovlive.v1.ClientMessage.subscribe: object expected");
                    message.subscribe = $root.ovlive.v1.Subscribe.fromObject(object.subscribe, long + 1);
                }
                if (object.update_viewport != null) {
                    if (!$util.isObject(object.update_viewport))
                        throw TypeError(".ovlive.v1.ClientMessage.update_viewport: object expected");
                    message.update_viewport = $root.ovlive.v1.UpdateViewport.fromObject(object.update_viewport, long + 1);
                }
                if (object.ping != null)
                    message.ping = Boolean(object.ping);
                return message;
            };

            /**
             * Creates a plain object from a ClientMessage message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.ClientMessage
             * @static
             * @param {ovlive.v1.ClientMessage} message ClientMessage
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            ClientMessage.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (message.subscribe != null && Object.hasOwnProperty.call(message, "subscribe")) {
                    object.subscribe = $root.ovlive.v1.Subscribe.toObject(message.subscribe, options, q + 1);
                    if (options.oneofs)
                        object.payload = "subscribe";
                }
                if (message.update_viewport != null && Object.hasOwnProperty.call(message, "update_viewport")) {
                    object.update_viewport = $root.ovlive.v1.UpdateViewport.toObject(message.update_viewport, options, q + 1);
                    if (options.oneofs)
                        object.payload = "update_viewport";
                }
                if (message.ping != null && Object.hasOwnProperty.call(message, "ping")) {
                    object.ping = message.ping;
                    if (options.oneofs)
                        object.payload = "ping";
                }
                return object;
            };

            /**
             * Converts this ClientMessage to JSON.
             * @function toJSON
             * @memberof ovlive.v1.ClientMessage
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            ClientMessage.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for ClientMessage
             * @function getTypeUrl
             * @memberof ovlive.v1.ClientMessage
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            ClientMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.ClientMessage";
            };

            return ClientMessage;
        })();

        v1.VehicleState = (function() {

            /**
             * Properties of a VehicleState.
             * @memberof ovlive.v1
             * @interface IVehicleState
             * @property {string|null} [id] VehicleState id
             * @property {string|null} [dataowner] VehicleState dataowner
             * @property {string|null} [vehicle_number] VehicleState vehicle_number
             * @property {string|null} [line_public_number] VehicleState line_public_number
             * @property {ovlive.v1.VehicleType|null} [vehicle_type] VehicleState vehicle_type
             * @property {string|null} [operator_name] VehicleState operator_name
             * @property {number|null} [lat] VehicleState lat
             * @property {number|null} [lon] VehicleState lon
             * @property {number|null} [bearing] VehicleState bearing
             * @property {number|null} [delay_seconds] VehicleState delay_seconds
             * @property {boolean|null} [delay_known] VehicleState delay_known
             * @property {string|null} [destination] VehicleState destination
             * @property {string|null} [block_code] VehicleState block_code
             * @property {string|null} [journey_number] VehicleState journey_number
             * @property {boolean|null} [at_stop] VehicleState at_stop
             * @property {string|null} [current_stop_id] VehicleState current_stop_id
             * @property {string|null} [line_color] VehicleState line_color
             * @property {string|null} [line_text_color] VehicleState line_text_color
             * @property {boolean|null} [schedule_positioned] VehicleState schedule_positioned
             * @property {number|null} [speed_kmh] VehicleState speed_kmh
             * @property {boolean|null} [speed_known] VehicleState speed_known
             */

            /**
             * Constructs a new VehicleState.
             * @memberof ovlive.v1
             * @classdesc Represents a VehicleState.
             * @implements IVehicleState
             * @constructor
             * @param {ovlive.v1.IVehicleState=} [properties] Properties to set
             */
            function VehicleState(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * VehicleState id.
             * @member {string} id
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.id = "";

            /**
             * VehicleState dataowner.
             * @member {string} dataowner
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.dataowner = "";

            /**
             * VehicleState vehicle_number.
             * @member {string} vehicle_number
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.vehicle_number = "";

            /**
             * VehicleState line_public_number.
             * @member {string} line_public_number
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.line_public_number = "";

            /**
             * VehicleState vehicle_type.
             * @member {ovlive.v1.VehicleType} vehicle_type
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.vehicle_type = 0;

            /**
             * VehicleState operator_name.
             * @member {string} operator_name
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.operator_name = "";

            /**
             * VehicleState lat.
             * @member {number} lat
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.lat = 0;

            /**
             * VehicleState lon.
             * @member {number} lon
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.lon = 0;

            /**
             * VehicleState bearing.
             * @member {number} bearing
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.bearing = 0;

            /**
             * VehicleState delay_seconds.
             * @member {number} delay_seconds
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.delay_seconds = 0;

            /**
             * VehicleState delay_known.
             * @member {boolean} delay_known
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.delay_known = false;

            /**
             * VehicleState destination.
             * @member {string} destination
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.destination = "";

            /**
             * VehicleState block_code.
             * @member {string} block_code
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.block_code = "";

            /**
             * VehicleState journey_number.
             * @member {string} journey_number
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.journey_number = "";

            /**
             * VehicleState at_stop.
             * @member {boolean} at_stop
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.at_stop = false;

            /**
             * VehicleState current_stop_id.
             * @member {string} current_stop_id
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.current_stop_id = "";

            /**
             * VehicleState line_color.
             * @member {string} line_color
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.line_color = "";

            /**
             * VehicleState line_text_color.
             * @member {string} line_text_color
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.line_text_color = "";

            /**
             * VehicleState schedule_positioned.
             * @member {boolean} schedule_positioned
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.schedule_positioned = false;

            /**
             * VehicleState speed_kmh.
             * @member {number} speed_kmh
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.speed_kmh = 0;

            /**
             * VehicleState speed_known.
             * @member {boolean} speed_known
             * @memberof ovlive.v1.VehicleState
             * @instance
             */
            VehicleState.prototype.speed_known = false;

            /**
             * Encodes the specified VehicleState message. Does not implicitly {@link ovlive.v1.VehicleState.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.VehicleState
             * @static
             * @param {ovlive.v1.IVehicleState} message VehicleState message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            VehicleState.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                    writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
                if (message.dataowner != null && Object.hasOwnProperty.call(message, "dataowner"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.dataowner);
                if (message.vehicle_number != null && Object.hasOwnProperty.call(message, "vehicle_number"))
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.vehicle_number);
                if (message.line_public_number != null && Object.hasOwnProperty.call(message, "line_public_number"))
                    writer.uint32(/* id 4, wireType 2 =*/34).string(message.line_public_number);
                if (message.vehicle_type != null && Object.hasOwnProperty.call(message, "vehicle_type"))
                    writer.uint32(/* id 5, wireType 0 =*/40).int32(message.vehicle_type);
                if (message.operator_name != null && Object.hasOwnProperty.call(message, "operator_name"))
                    writer.uint32(/* id 6, wireType 2 =*/50).string(message.operator_name);
                if (message.lat != null && Object.hasOwnProperty.call(message, "lat"))
                    writer.uint32(/* id 7, wireType 1 =*/57).double(message.lat);
                if (message.lon != null && Object.hasOwnProperty.call(message, "lon"))
                    writer.uint32(/* id 8, wireType 1 =*/65).double(message.lon);
                if (message.bearing != null && Object.hasOwnProperty.call(message, "bearing"))
                    writer.uint32(/* id 9, wireType 5 =*/77).float(message.bearing);
                if (message.delay_seconds != null && Object.hasOwnProperty.call(message, "delay_seconds"))
                    writer.uint32(/* id 10, wireType 0 =*/80).int32(message.delay_seconds);
                if (message.destination != null && Object.hasOwnProperty.call(message, "destination"))
                    writer.uint32(/* id 11, wireType 2 =*/90).string(message.destination);
                if (message.block_code != null && Object.hasOwnProperty.call(message, "block_code"))
                    writer.uint32(/* id 12, wireType 2 =*/98).string(message.block_code);
                if (message.journey_number != null && Object.hasOwnProperty.call(message, "journey_number"))
                    writer.uint32(/* id 13, wireType 2 =*/106).string(message.journey_number);
                if (message.at_stop != null && Object.hasOwnProperty.call(message, "at_stop"))
                    writer.uint32(/* id 14, wireType 0 =*/112).bool(message.at_stop);
                if (message.current_stop_id != null && Object.hasOwnProperty.call(message, "current_stop_id"))
                    writer.uint32(/* id 15, wireType 2 =*/122).string(message.current_stop_id);
                if (message.line_color != null && Object.hasOwnProperty.call(message, "line_color"))
                    writer.uint32(/* id 16, wireType 2 =*/130).string(message.line_color);
                if (message.line_text_color != null && Object.hasOwnProperty.call(message, "line_text_color"))
                    writer.uint32(/* id 17, wireType 2 =*/138).string(message.line_text_color);
                if (message.delay_known != null && Object.hasOwnProperty.call(message, "delay_known"))
                    writer.uint32(/* id 21, wireType 0 =*/168).bool(message.delay_known);
                if (message.schedule_positioned != null && Object.hasOwnProperty.call(message, "schedule_positioned"))
                    writer.uint32(/* id 22, wireType 0 =*/176).bool(message.schedule_positioned);
                if (message.speed_kmh != null && Object.hasOwnProperty.call(message, "speed_kmh"))
                    writer.uint32(/* id 23, wireType 5 =*/189).float(message.speed_kmh);
                if (message.speed_known != null && Object.hasOwnProperty.call(message, "speed_known"))
                    writer.uint32(/* id 24, wireType 0 =*/192).bool(message.speed_known);
                return writer;
            };

            /**
             * Decodes a VehicleState message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.VehicleState
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.VehicleState} VehicleState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            VehicleState.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.VehicleState();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.id = reader.string();
                            break;
                        }
                    case 2: {
                            message.dataowner = reader.string();
                            break;
                        }
                    case 3: {
                            message.vehicle_number = reader.string();
                            break;
                        }
                    case 4: {
                            message.line_public_number = reader.string();
                            break;
                        }
                    case 5: {
                            message.vehicle_type = reader.int32();
                            break;
                        }
                    case 6: {
                            message.operator_name = reader.string();
                            break;
                        }
                    case 7: {
                            message.lat = reader.double();
                            break;
                        }
                    case 8: {
                            message.lon = reader.double();
                            break;
                        }
                    case 9: {
                            message.bearing = reader.float();
                            break;
                        }
                    case 10: {
                            message.delay_seconds = reader.int32();
                            break;
                        }
                    case 21: {
                            message.delay_known = reader.bool();
                            break;
                        }
                    case 11: {
                            message.destination = reader.string();
                            break;
                        }
                    case 12: {
                            message.block_code = reader.string();
                            break;
                        }
                    case 13: {
                            message.journey_number = reader.string();
                            break;
                        }
                    case 14: {
                            message.at_stop = reader.bool();
                            break;
                        }
                    case 15: {
                            message.current_stop_id = reader.string();
                            break;
                        }
                    case 16: {
                            message.line_color = reader.string();
                            break;
                        }
                    case 17: {
                            message.line_text_color = reader.string();
                            break;
                        }
                    case 22: {
                            message.schedule_positioned = reader.bool();
                            break;
                        }
                    case 23: {
                            message.speed_kmh = reader.float();
                            break;
                        }
                    case 24: {
                            message.speed_known = reader.bool();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a VehicleState message.
             * @function verify
             * @memberof ovlive.v1.VehicleState
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            VehicleState.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                    if (!$util.isString(message.id))
                        return "id: string expected";
                if (message.dataowner != null && Object.hasOwnProperty.call(message, "dataowner"))
                    if (!$util.isString(message.dataowner))
                        return "dataowner: string expected";
                if (message.vehicle_number != null && Object.hasOwnProperty.call(message, "vehicle_number"))
                    if (!$util.isString(message.vehicle_number))
                        return "vehicle_number: string expected";
                if (message.line_public_number != null && Object.hasOwnProperty.call(message, "line_public_number"))
                    if (!$util.isString(message.line_public_number))
                        return "line_public_number: string expected";
                if (message.vehicle_type != null && Object.hasOwnProperty.call(message, "vehicle_type"))
                    switch (message.vehicle_type) {
                    default:
                        return "vehicle_type: enum value expected";
                    case 0:
                    case 1:
                    case 2:
                    case 3:
                    case 4:
                    case 5:
                        break;
                    }
                if (message.operator_name != null && Object.hasOwnProperty.call(message, "operator_name"))
                    if (!$util.isString(message.operator_name))
                        return "operator_name: string expected";
                if (message.lat != null && Object.hasOwnProperty.call(message, "lat"))
                    if (typeof message.lat !== "number")
                        return "lat: number expected";
                if (message.lon != null && Object.hasOwnProperty.call(message, "lon"))
                    if (typeof message.lon !== "number")
                        return "lon: number expected";
                if (message.bearing != null && Object.hasOwnProperty.call(message, "bearing"))
                    if (typeof message.bearing !== "number")
                        return "bearing: number expected";
                if (message.delay_seconds != null && Object.hasOwnProperty.call(message, "delay_seconds"))
                    if (!$util.isInteger(message.delay_seconds))
                        return "delay_seconds: integer expected";
                if (message.delay_known != null && Object.hasOwnProperty.call(message, "delay_known"))
                    if (typeof message.delay_known !== "boolean")
                        return "delay_known: boolean expected";
                if (message.destination != null && Object.hasOwnProperty.call(message, "destination"))
                    if (!$util.isString(message.destination))
                        return "destination: string expected";
                if (message.block_code != null && Object.hasOwnProperty.call(message, "block_code"))
                    if (!$util.isString(message.block_code))
                        return "block_code: string expected";
                if (message.journey_number != null && Object.hasOwnProperty.call(message, "journey_number"))
                    if (!$util.isString(message.journey_number))
                        return "journey_number: string expected";
                if (message.at_stop != null && Object.hasOwnProperty.call(message, "at_stop"))
                    if (typeof message.at_stop !== "boolean")
                        return "at_stop: boolean expected";
                if (message.current_stop_id != null && Object.hasOwnProperty.call(message, "current_stop_id"))
                    if (!$util.isString(message.current_stop_id))
                        return "current_stop_id: string expected";
                if (message.line_color != null && Object.hasOwnProperty.call(message, "line_color"))
                    if (!$util.isString(message.line_color))
                        return "line_color: string expected";
                if (message.line_text_color != null && Object.hasOwnProperty.call(message, "line_text_color"))
                    if (!$util.isString(message.line_text_color))
                        return "line_text_color: string expected";
                if (message.schedule_positioned != null && Object.hasOwnProperty.call(message, "schedule_positioned"))
                    if (typeof message.schedule_positioned !== "boolean")
                        return "schedule_positioned: boolean expected";
                if (message.speed_kmh != null && Object.hasOwnProperty.call(message, "speed_kmh"))
                    if (typeof message.speed_kmh !== "number")
                        return "speed_kmh: number expected";
                if (message.speed_known != null && Object.hasOwnProperty.call(message, "speed_known"))
                    if (typeof message.speed_known !== "boolean")
                        return "speed_known: boolean expected";
                return null;
            };

            /**
             * Creates a VehicleState message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.VehicleState
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.VehicleState} VehicleState
             */
            VehicleState.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.VehicleState)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.VehicleState: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.VehicleState();
                if (object.id != null)
                    message.id = String(object.id);
                if (object.dataowner != null)
                    message.dataowner = String(object.dataowner);
                if (object.vehicle_number != null)
                    message.vehicle_number = String(object.vehicle_number);
                if (object.line_public_number != null)
                    message.line_public_number = String(object.line_public_number);
                switch (object.vehicle_type) {
                default:
                    if (typeof object.vehicle_type === "number") {
                        message.vehicle_type = object.vehicle_type;
                        break;
                    }
                    break;
                case "VEHICLE_TYPE_UNSPECIFIED":
                case 0:
                    message.vehicle_type = 0;
                    break;
                case "BUS":
                case 1:
                    message.vehicle_type = 1;
                    break;
                case "TRAM":
                case 2:
                    message.vehicle_type = 2;
                    break;
                case "METRO":
                case 3:
                    message.vehicle_type = 3;
                    break;
                case "TRAIN":
                case 4:
                    message.vehicle_type = 4;
                    break;
                case "FERRY":
                case 5:
                    message.vehicle_type = 5;
                    break;
                }
                if (object.operator_name != null)
                    message.operator_name = String(object.operator_name);
                if (object.lat != null)
                    message.lat = Number(object.lat);
                if (object.lon != null)
                    message.lon = Number(object.lon);
                if (object.bearing != null)
                    message.bearing = Number(object.bearing);
                if (object.delay_seconds != null)
                    message.delay_seconds = object.delay_seconds | 0;
                if (object.delay_known != null)
                    message.delay_known = Boolean(object.delay_known);
                if (object.destination != null)
                    message.destination = String(object.destination);
                if (object.block_code != null)
                    message.block_code = String(object.block_code);
                if (object.journey_number != null)
                    message.journey_number = String(object.journey_number);
                if (object.at_stop != null)
                    message.at_stop = Boolean(object.at_stop);
                if (object.current_stop_id != null)
                    message.current_stop_id = String(object.current_stop_id);
                if (object.line_color != null)
                    message.line_color = String(object.line_color);
                if (object.line_text_color != null)
                    message.line_text_color = String(object.line_text_color);
                if (object.schedule_positioned != null)
                    message.schedule_positioned = Boolean(object.schedule_positioned);
                if (object.speed_kmh != null)
                    message.speed_kmh = Number(object.speed_kmh);
                if (object.speed_known != null)
                    message.speed_known = Boolean(object.speed_known);
                return message;
            };

            /**
             * Creates a plain object from a VehicleState message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.VehicleState
             * @static
             * @param {ovlive.v1.VehicleState} message VehicleState
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            VehicleState.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.id = "";
                    object.dataowner = "";
                    object.vehicle_number = "";
                    object.line_public_number = "";
                    object.vehicle_type = options.enums === String ? "VEHICLE_TYPE_UNSPECIFIED" : 0;
                    object.operator_name = "";
                    object.lat = 0;
                    object.lon = 0;
                    object.bearing = 0;
                    object.delay_seconds = 0;
                    object.destination = "";
                    object.block_code = "";
                    object.journey_number = "";
                    object.at_stop = false;
                    object.current_stop_id = "";
                    object.line_color = "";
                    object.line_text_color = "";
                    object.delay_known = false;
                    object.schedule_positioned = false;
                    object.speed_kmh = 0;
                    object.speed_known = false;
                }
                if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                    object.id = message.id;
                if (message.dataowner != null && Object.hasOwnProperty.call(message, "dataowner"))
                    object.dataowner = message.dataowner;
                if (message.vehicle_number != null && Object.hasOwnProperty.call(message, "vehicle_number"))
                    object.vehicle_number = message.vehicle_number;
                if (message.line_public_number != null && Object.hasOwnProperty.call(message, "line_public_number"))
                    object.line_public_number = message.line_public_number;
                if (message.vehicle_type != null && Object.hasOwnProperty.call(message, "vehicle_type"))
                    object.vehicle_type = options.enums === String ? $root.ovlive.v1.VehicleType[message.vehicle_type] === undefined ? message.vehicle_type : $root.ovlive.v1.VehicleType[message.vehicle_type] : message.vehicle_type;
                if (message.operator_name != null && Object.hasOwnProperty.call(message, "operator_name"))
                    object.operator_name = message.operator_name;
                if (message.lat != null && Object.hasOwnProperty.call(message, "lat"))
                    object.lat = options.json && !isFinite(message.lat) ? String(message.lat) : message.lat;
                if (message.lon != null && Object.hasOwnProperty.call(message, "lon"))
                    object.lon = options.json && !isFinite(message.lon) ? String(message.lon) : message.lon;
                if (message.bearing != null && Object.hasOwnProperty.call(message, "bearing"))
                    object.bearing = options.json && !isFinite(message.bearing) ? String(message.bearing) : message.bearing;
                if (message.delay_seconds != null && Object.hasOwnProperty.call(message, "delay_seconds"))
                    object.delay_seconds = message.delay_seconds;
                if (message.destination != null && Object.hasOwnProperty.call(message, "destination"))
                    object.destination = message.destination;
                if (message.block_code != null && Object.hasOwnProperty.call(message, "block_code"))
                    object.block_code = message.block_code;
                if (message.journey_number != null && Object.hasOwnProperty.call(message, "journey_number"))
                    object.journey_number = message.journey_number;
                if (message.at_stop != null && Object.hasOwnProperty.call(message, "at_stop"))
                    object.at_stop = message.at_stop;
                if (message.current_stop_id != null && Object.hasOwnProperty.call(message, "current_stop_id"))
                    object.current_stop_id = message.current_stop_id;
                if (message.line_color != null && Object.hasOwnProperty.call(message, "line_color"))
                    object.line_color = message.line_color;
                if (message.line_text_color != null && Object.hasOwnProperty.call(message, "line_text_color"))
                    object.line_text_color = message.line_text_color;
                if (message.delay_known != null && Object.hasOwnProperty.call(message, "delay_known"))
                    object.delay_known = message.delay_known;
                if (message.schedule_positioned != null && Object.hasOwnProperty.call(message, "schedule_positioned"))
                    object.schedule_positioned = message.schedule_positioned;
                if (message.speed_kmh != null && Object.hasOwnProperty.call(message, "speed_kmh"))
                    object.speed_kmh = options.json && !isFinite(message.speed_kmh) ? String(message.speed_kmh) : message.speed_kmh;
                if (message.speed_known != null && Object.hasOwnProperty.call(message, "speed_known"))
                    object.speed_known = message.speed_known;
                return object;
            };

            /**
             * Converts this VehicleState to JSON.
             * @function toJSON
             * @memberof ovlive.v1.VehicleState
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            VehicleState.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for VehicleState
             * @function getTypeUrl
             * @memberof ovlive.v1.VehicleState
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            VehicleState.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.VehicleState";
            };

            return VehicleState;
        })();

        v1.VehicleMove = (function() {

            /**
             * Properties of a VehicleMove.
             * @memberof ovlive.v1
             * @interface IVehicleMove
             * @property {string|null} [id] VehicleMove id
             * @property {number|null} [lat] VehicleMove lat
             * @property {number|null} [lon] VehicleMove lon
             * @property {number|null} [bearing] VehicleMove bearing
             * @property {number|null} [delay_seconds] VehicleMove delay_seconds
             * @property {boolean|null} [delay_known] VehicleMove delay_known
             * @property {boolean|null} [at_stop] VehicleMove at_stop
             * @property {string|null} [current_stop_id] VehicleMove current_stop_id
             * @property {boolean|null} [schedule_positioned] VehicleMove schedule_positioned
             * @property {number|null} [speed_kmh] VehicleMove speed_kmh
             * @property {boolean|null} [speed_known] VehicleMove speed_known
             */

            /**
             * Constructs a new VehicleMove.
             * @memberof ovlive.v1
             * @classdesc Represents a VehicleMove.
             * @implements IVehicleMove
             * @constructor
             * @param {ovlive.v1.IVehicleMove=} [properties] Properties to set
             */
            function VehicleMove(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * VehicleMove id.
             * @member {string} id
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.id = "";

            /**
             * VehicleMove lat.
             * @member {number} lat
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.lat = 0;

            /**
             * VehicleMove lon.
             * @member {number} lon
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.lon = 0;

            /**
             * VehicleMove bearing.
             * @member {number} bearing
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.bearing = 0;

            /**
             * VehicleMove delay_seconds.
             * @member {number} delay_seconds
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.delay_seconds = 0;

            /**
             * VehicleMove delay_known.
             * @member {boolean} delay_known
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.delay_known = false;

            /**
             * VehicleMove at_stop.
             * @member {boolean} at_stop
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.at_stop = false;

            /**
             * VehicleMove current_stop_id.
             * @member {string} current_stop_id
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.current_stop_id = "";

            /**
             * VehicleMove schedule_positioned.
             * @member {boolean} schedule_positioned
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.schedule_positioned = false;

            /**
             * VehicleMove speed_kmh.
             * @member {number} speed_kmh
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.speed_kmh = 0;

            /**
             * VehicleMove speed_known.
             * @member {boolean} speed_known
             * @memberof ovlive.v1.VehicleMove
             * @instance
             */
            VehicleMove.prototype.speed_known = false;

            /**
             * Encodes the specified VehicleMove message. Does not implicitly {@link ovlive.v1.VehicleMove.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.VehicleMove
             * @static
             * @param {ovlive.v1.IVehicleMove} message VehicleMove message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            VehicleMove.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                    writer.uint32(/* id 1, wireType 2 =*/10).string(message.id);
                if (message.lat != null && Object.hasOwnProperty.call(message, "lat"))
                    writer.uint32(/* id 2, wireType 1 =*/17).double(message.lat);
                if (message.lon != null && Object.hasOwnProperty.call(message, "lon"))
                    writer.uint32(/* id 3, wireType 1 =*/25).double(message.lon);
                if (message.bearing != null && Object.hasOwnProperty.call(message, "bearing"))
                    writer.uint32(/* id 4, wireType 5 =*/37).float(message.bearing);
                if (message.delay_seconds != null && Object.hasOwnProperty.call(message, "delay_seconds"))
                    writer.uint32(/* id 5, wireType 0 =*/40).int32(message.delay_seconds);
                if (message.at_stop != null && Object.hasOwnProperty.call(message, "at_stop"))
                    writer.uint32(/* id 6, wireType 0 =*/48).bool(message.at_stop);
                if (message.current_stop_id != null && Object.hasOwnProperty.call(message, "current_stop_id"))
                    writer.uint32(/* id 7, wireType 2 =*/58).string(message.current_stop_id);
                if (message.delay_known != null && Object.hasOwnProperty.call(message, "delay_known"))
                    writer.uint32(/* id 8, wireType 0 =*/64).bool(message.delay_known);
                if (message.schedule_positioned != null && Object.hasOwnProperty.call(message, "schedule_positioned"))
                    writer.uint32(/* id 9, wireType 0 =*/72).bool(message.schedule_positioned);
                if (message.speed_kmh != null && Object.hasOwnProperty.call(message, "speed_kmh"))
                    writer.uint32(/* id 10, wireType 5 =*/85).float(message.speed_kmh);
                if (message.speed_known != null && Object.hasOwnProperty.call(message, "speed_known"))
                    writer.uint32(/* id 11, wireType 0 =*/88).bool(message.speed_known);
                return writer;
            };

            /**
             * Decodes a VehicleMove message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.VehicleMove
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.VehicleMove} VehicleMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            VehicleMove.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.VehicleMove();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.id = reader.string();
                            break;
                        }
                    case 2: {
                            message.lat = reader.double();
                            break;
                        }
                    case 3: {
                            message.lon = reader.double();
                            break;
                        }
                    case 4: {
                            message.bearing = reader.float();
                            break;
                        }
                    case 5: {
                            message.delay_seconds = reader.int32();
                            break;
                        }
                    case 8: {
                            message.delay_known = reader.bool();
                            break;
                        }
                    case 6: {
                            message.at_stop = reader.bool();
                            break;
                        }
                    case 7: {
                            message.current_stop_id = reader.string();
                            break;
                        }
                    case 9: {
                            message.schedule_positioned = reader.bool();
                            break;
                        }
                    case 10: {
                            message.speed_kmh = reader.float();
                            break;
                        }
                    case 11: {
                            message.speed_known = reader.bool();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a VehicleMove message.
             * @function verify
             * @memberof ovlive.v1.VehicleMove
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            VehicleMove.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                    if (!$util.isString(message.id))
                        return "id: string expected";
                if (message.lat != null && Object.hasOwnProperty.call(message, "lat"))
                    if (typeof message.lat !== "number")
                        return "lat: number expected";
                if (message.lon != null && Object.hasOwnProperty.call(message, "lon"))
                    if (typeof message.lon !== "number")
                        return "lon: number expected";
                if (message.bearing != null && Object.hasOwnProperty.call(message, "bearing"))
                    if (typeof message.bearing !== "number")
                        return "bearing: number expected";
                if (message.delay_seconds != null && Object.hasOwnProperty.call(message, "delay_seconds"))
                    if (!$util.isInteger(message.delay_seconds))
                        return "delay_seconds: integer expected";
                if (message.delay_known != null && Object.hasOwnProperty.call(message, "delay_known"))
                    if (typeof message.delay_known !== "boolean")
                        return "delay_known: boolean expected";
                if (message.at_stop != null && Object.hasOwnProperty.call(message, "at_stop"))
                    if (typeof message.at_stop !== "boolean")
                        return "at_stop: boolean expected";
                if (message.current_stop_id != null && Object.hasOwnProperty.call(message, "current_stop_id"))
                    if (!$util.isString(message.current_stop_id))
                        return "current_stop_id: string expected";
                if (message.schedule_positioned != null && Object.hasOwnProperty.call(message, "schedule_positioned"))
                    if (typeof message.schedule_positioned !== "boolean")
                        return "schedule_positioned: boolean expected";
                if (message.speed_kmh != null && Object.hasOwnProperty.call(message, "speed_kmh"))
                    if (typeof message.speed_kmh !== "number")
                        return "speed_kmh: number expected";
                if (message.speed_known != null && Object.hasOwnProperty.call(message, "speed_known"))
                    if (typeof message.speed_known !== "boolean")
                        return "speed_known: boolean expected";
                return null;
            };

            /**
             * Creates a VehicleMove message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.VehicleMove
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.VehicleMove} VehicleMove
             */
            VehicleMove.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.VehicleMove)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.VehicleMove: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.VehicleMove();
                if (object.id != null)
                    message.id = String(object.id);
                if (object.lat != null)
                    message.lat = Number(object.lat);
                if (object.lon != null)
                    message.lon = Number(object.lon);
                if (object.bearing != null)
                    message.bearing = Number(object.bearing);
                if (object.delay_seconds != null)
                    message.delay_seconds = object.delay_seconds | 0;
                if (object.delay_known != null)
                    message.delay_known = Boolean(object.delay_known);
                if (object.at_stop != null)
                    message.at_stop = Boolean(object.at_stop);
                if (object.current_stop_id != null)
                    message.current_stop_id = String(object.current_stop_id);
                if (object.schedule_positioned != null)
                    message.schedule_positioned = Boolean(object.schedule_positioned);
                if (object.speed_kmh != null)
                    message.speed_kmh = Number(object.speed_kmh);
                if (object.speed_known != null)
                    message.speed_known = Boolean(object.speed_known);
                return message;
            };

            /**
             * Creates a plain object from a VehicleMove message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.VehicleMove
             * @static
             * @param {ovlive.v1.VehicleMove} message VehicleMove
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            VehicleMove.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.id = "";
                    object.lat = 0;
                    object.lon = 0;
                    object.bearing = 0;
                    object.delay_seconds = 0;
                    object.at_stop = false;
                    object.current_stop_id = "";
                    object.delay_known = false;
                    object.schedule_positioned = false;
                    object.speed_kmh = 0;
                    object.speed_known = false;
                }
                if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                    object.id = message.id;
                if (message.lat != null && Object.hasOwnProperty.call(message, "lat"))
                    object.lat = options.json && !isFinite(message.lat) ? String(message.lat) : message.lat;
                if (message.lon != null && Object.hasOwnProperty.call(message, "lon"))
                    object.lon = options.json && !isFinite(message.lon) ? String(message.lon) : message.lon;
                if (message.bearing != null && Object.hasOwnProperty.call(message, "bearing"))
                    object.bearing = options.json && !isFinite(message.bearing) ? String(message.bearing) : message.bearing;
                if (message.delay_seconds != null && Object.hasOwnProperty.call(message, "delay_seconds"))
                    object.delay_seconds = message.delay_seconds;
                if (message.at_stop != null && Object.hasOwnProperty.call(message, "at_stop"))
                    object.at_stop = message.at_stop;
                if (message.current_stop_id != null && Object.hasOwnProperty.call(message, "current_stop_id"))
                    object.current_stop_id = message.current_stop_id;
                if (message.delay_known != null && Object.hasOwnProperty.call(message, "delay_known"))
                    object.delay_known = message.delay_known;
                if (message.schedule_positioned != null && Object.hasOwnProperty.call(message, "schedule_positioned"))
                    object.schedule_positioned = message.schedule_positioned;
                if (message.speed_kmh != null && Object.hasOwnProperty.call(message, "speed_kmh"))
                    object.speed_kmh = options.json && !isFinite(message.speed_kmh) ? String(message.speed_kmh) : message.speed_kmh;
                if (message.speed_known != null && Object.hasOwnProperty.call(message, "speed_known"))
                    object.speed_known = message.speed_known;
                return object;
            };

            /**
             * Converts this VehicleMove to JSON.
             * @function toJSON
             * @memberof ovlive.v1.VehicleMove
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            VehicleMove.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for VehicleMove
             * @function getTypeUrl
             * @memberof ovlive.v1.VehicleMove
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            VehicleMove.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.VehicleMove";
            };

            return VehicleMove;
        })();

        v1.Update = (function() {

            /**
             * Properties of an Update.
             * @memberof ovlive.v1
             * @interface IUpdate
             * @property {Array.<ovlive.v1.IVehicleState>|null} [entered] Update entered
             * @property {Array.<ovlive.v1.IVehicleMove>|null} [moved] Update moved
             * @property {Array.<string>|null} [left] Update left
             * @property {boolean|null} [is_snapshot] Update is_snapshot
             */

            /**
             * Constructs a new Update.
             * @memberof ovlive.v1
             * @classdesc Represents an Update.
             * @implements IUpdate
             * @constructor
             * @param {ovlive.v1.IUpdate=} [properties] Properties to set
             */
            function Update(properties) {
                this.entered = [];
                this.moved = [];
                this.left = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Update entered.
             * @member {Array.<ovlive.v1.IVehicleState>} entered
             * @memberof ovlive.v1.Update
             * @instance
             */
            Update.prototype.entered = $util.emptyArray;

            /**
             * Update moved.
             * @member {Array.<ovlive.v1.IVehicleMove>} moved
             * @memberof ovlive.v1.Update
             * @instance
             */
            Update.prototype.moved = $util.emptyArray;

            /**
             * Update left.
             * @member {Array.<string>} left
             * @memberof ovlive.v1.Update
             * @instance
             */
            Update.prototype.left = $util.emptyArray;

            /**
             * Update is_snapshot.
             * @member {boolean} is_snapshot
             * @memberof ovlive.v1.Update
             * @instance
             */
            Update.prototype.is_snapshot = false;

            /**
             * Encodes the specified Update message. Does not implicitly {@link ovlive.v1.Update.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.Update
             * @static
             * @param {ovlive.v1.IUpdate} message Update message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Update.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.entered != null && message.entered.length)
                    for (let i = 0; i < message.entered.length; ++i)
                        $root.ovlive.v1.VehicleState.encode(message.entered[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), q + 1).ldelim();
                if (message.moved != null && message.moved.length)
                    for (let i = 0; i < message.moved.length; ++i)
                        $root.ovlive.v1.VehicleMove.encode(message.moved[i], writer.uint32(/* id 2, wireType 2 =*/18).fork(), q + 1).ldelim();
                if (message.left != null && message.left.length)
                    for (let i = 0; i < message.left.length; ++i)
                        writer.uint32(/* id 3, wireType 2 =*/26).string(message.left[i]);
                if (message.is_snapshot != null && Object.hasOwnProperty.call(message, "is_snapshot"))
                    writer.uint32(/* id 4, wireType 0 =*/32).bool(message.is_snapshot);
                return writer;
            };

            /**
             * Decodes an Update message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.Update
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.Update} Update
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Update.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.Update();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            if (!(message.entered && message.entered.length))
                                message.entered = [];
                            message.entered.push($root.ovlive.v1.VehicleState.decode(reader, reader.uint32(), undefined, long + 1));
                            break;
                        }
                    case 2: {
                            if (!(message.moved && message.moved.length))
                                message.moved = [];
                            message.moved.push($root.ovlive.v1.VehicleMove.decode(reader, reader.uint32(), undefined, long + 1));
                            break;
                        }
                    case 3: {
                            if (!(message.left && message.left.length))
                                message.left = [];
                            message.left.push(reader.string());
                            break;
                        }
                    case 4: {
                            message.is_snapshot = reader.bool();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies an Update message.
             * @function verify
             * @memberof ovlive.v1.Update
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Update.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.entered != null && Object.hasOwnProperty.call(message, "entered")) {
                    if (!Array.isArray(message.entered))
                        return "entered: array expected";
                    for (let i = 0; i < message.entered.length; ++i) {
                        let error = $root.ovlive.v1.VehicleState.verify(message.entered[i], long + 1);
                        if (error)
                            return "entered." + error;
                    }
                }
                if (message.moved != null && Object.hasOwnProperty.call(message, "moved")) {
                    if (!Array.isArray(message.moved))
                        return "moved: array expected";
                    for (let i = 0; i < message.moved.length; ++i) {
                        let error = $root.ovlive.v1.VehicleMove.verify(message.moved[i], long + 1);
                        if (error)
                            return "moved." + error;
                    }
                }
                if (message.left != null && Object.hasOwnProperty.call(message, "left")) {
                    if (!Array.isArray(message.left))
                        return "left: array expected";
                    for (let i = 0; i < message.left.length; ++i)
                        if (!$util.isString(message.left[i]))
                            return "left: string[] expected";
                }
                if (message.is_snapshot != null && Object.hasOwnProperty.call(message, "is_snapshot"))
                    if (typeof message.is_snapshot !== "boolean")
                        return "is_snapshot: boolean expected";
                return null;
            };

            /**
             * Creates an Update message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.Update
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.Update} Update
             */
            Update.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.Update)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.Update: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.Update();
                if (object.entered) {
                    if (!Array.isArray(object.entered))
                        throw TypeError(".ovlive.v1.Update.entered: array expected");
                    message.entered = [];
                    for (let i = 0; i < object.entered.length; ++i) {
                        if (!$util.isObject(object.entered[i]))
                            throw TypeError(".ovlive.v1.Update.entered: object expected");
                        message.entered[i] = $root.ovlive.v1.VehicleState.fromObject(object.entered[i], long + 1);
                    }
                }
                if (object.moved) {
                    if (!Array.isArray(object.moved))
                        throw TypeError(".ovlive.v1.Update.moved: array expected");
                    message.moved = [];
                    for (let i = 0; i < object.moved.length; ++i) {
                        if (!$util.isObject(object.moved[i]))
                            throw TypeError(".ovlive.v1.Update.moved: object expected");
                        message.moved[i] = $root.ovlive.v1.VehicleMove.fromObject(object.moved[i], long + 1);
                    }
                }
                if (object.left) {
                    if (!Array.isArray(object.left))
                        throw TypeError(".ovlive.v1.Update.left: array expected");
                    message.left = [];
                    for (let i = 0; i < object.left.length; ++i)
                        message.left[i] = String(object.left[i]);
                }
                if (object.is_snapshot != null)
                    message.is_snapshot = Boolean(object.is_snapshot);
                return message;
            };

            /**
             * Creates a plain object from an Update message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.Update
             * @static
             * @param {ovlive.v1.Update} message Update
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Update.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.arrays || options.defaults) {
                    object.entered = [];
                    object.moved = [];
                    object.left = [];
                }
                if (options.defaults)
                    object.is_snapshot = false;
                if (message.entered && message.entered.length) {
                    object.entered = [];
                    for (let j = 0; j < message.entered.length; ++j)
                        object.entered[j] = $root.ovlive.v1.VehicleState.toObject(message.entered[j], options, q + 1);
                }
                if (message.moved && message.moved.length) {
                    object.moved = [];
                    for (let j = 0; j < message.moved.length; ++j)
                        object.moved[j] = $root.ovlive.v1.VehicleMove.toObject(message.moved[j], options, q + 1);
                }
                if (message.left && message.left.length) {
                    object.left = [];
                    for (let j = 0; j < message.left.length; ++j)
                        object.left[j] = message.left[j];
                }
                if (message.is_snapshot != null && Object.hasOwnProperty.call(message, "is_snapshot"))
                    object.is_snapshot = message.is_snapshot;
                return object;
            };

            /**
             * Converts this Update to JSON.
             * @function toJSON
             * @memberof ovlive.v1.Update
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Update.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Update
             * @function getTypeUrl
             * @memberof ovlive.v1.Update
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Update.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.Update";
            };

            return Update;
        })();

        v1.ServerError = (function() {

            /**
             * Properties of a ServerError.
             * @memberof ovlive.v1
             * @interface IServerError
             * @property {number|null} [code] ServerError code
             * @property {string|null} [message] ServerError message
             */

            /**
             * Constructs a new ServerError.
             * @memberof ovlive.v1
             * @classdesc Represents a ServerError.
             * @implements IServerError
             * @constructor
             * @param {ovlive.v1.IServerError=} [properties] Properties to set
             */
            function ServerError(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * ServerError code.
             * @member {number} code
             * @memberof ovlive.v1.ServerError
             * @instance
             */
            ServerError.prototype.code = 0;

            /**
             * ServerError message.
             * @member {string} message
             * @memberof ovlive.v1.ServerError
             * @instance
             */
            ServerError.prototype.message = "";

            /**
             * Encodes the specified ServerError message. Does not implicitly {@link ovlive.v1.ServerError.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.ServerError
             * @static
             * @param {ovlive.v1.IServerError} message ServerError message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            ServerError.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                    writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.code);
                if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.message);
                return writer;
            };

            /**
             * Decodes a ServerError message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.ServerError
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.ServerError} ServerError
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            ServerError.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.ServerError();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.code = reader.uint32();
                            break;
                        }
                    case 2: {
                            message.message = reader.string();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a ServerError message.
             * @function verify
             * @memberof ovlive.v1.ServerError
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            ServerError.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                    if (!$util.isInteger(message.code))
                        return "code: integer expected";
                if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                    if (!$util.isString(message.message))
                        return "message: string expected";
                return null;
            };

            /**
             * Creates a ServerError message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.ServerError
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.ServerError} ServerError
             */
            ServerError.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.ServerError)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.ServerError: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.ServerError();
                if (object.code != null)
                    message.code = object.code >>> 0;
                if (object.message != null)
                    message.message = String(object.message);
                return message;
            };

            /**
             * Creates a plain object from a ServerError message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.ServerError
             * @static
             * @param {ovlive.v1.ServerError} message ServerError
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            ServerError.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (options.defaults) {
                    object.code = 0;
                    object.message = "";
                }
                if (message.code != null && Object.hasOwnProperty.call(message, "code"))
                    object.code = message.code;
                if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                    object.message = message.message;
                return object;
            };

            /**
             * Converts this ServerError to JSON.
             * @function toJSON
             * @memberof ovlive.v1.ServerError
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            ServerError.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for ServerError
             * @function getTypeUrl
             * @memberof ovlive.v1.ServerError
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            ServerError.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.ServerError";
            };

            return ServerError;
        })();

        v1.ServerMessage = (function() {

            /**
             * Properties of a ServerMessage.
             * @memberof ovlive.v1
             * @interface IServerMessage
             * @property {ovlive.v1.IUpdate|null} [update] ServerMessage update
             * @property {boolean|null} [pong] ServerMessage pong
             * @property {ovlive.v1.IServerError|null} [error] ServerMessage error
             */

            /**
             * Constructs a new ServerMessage.
             * @memberof ovlive.v1
             * @classdesc Represents a ServerMessage.
             * @implements IServerMessage
             * @constructor
             * @param {ovlive.v1.IServerMessage=} [properties] Properties to set
             */
            function ServerMessage(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null && keys[i] !== "__proto__")
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * ServerMessage update.
             * @member {ovlive.v1.IUpdate|null|undefined} update
             * @memberof ovlive.v1.ServerMessage
             * @instance
             */
            ServerMessage.prototype.update = null;

            /**
             * ServerMessage pong.
             * @member {boolean|null|undefined} pong
             * @memberof ovlive.v1.ServerMessage
             * @instance
             */
            ServerMessage.prototype.pong = null;

            /**
             * ServerMessage error.
             * @member {ovlive.v1.IServerError|null|undefined} error
             * @memberof ovlive.v1.ServerMessage
             * @instance
             */
            ServerMessage.prototype.error = null;

            // OneOf field names bound to virtual getters and setters
            let $oneOfFields;

            /**
             * ServerMessage payload.
             * @member {"update"|"pong"|"error"|undefined} payload
             * @memberof ovlive.v1.ServerMessage
             * @instance
             */
            Object.defineProperty(ServerMessage.prototype, "payload", {
                get: $util.oneOfGetter($oneOfFields = ["update", "pong", "error"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            /**
             * Encodes the specified ServerMessage message. Does not implicitly {@link ovlive.v1.ServerMessage.verify|verify} messages.
             * @function encode
             * @memberof ovlive.v1.ServerMessage
             * @static
             * @param {ovlive.v1.IServerMessage} message ServerMessage message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            ServerMessage.encode = function encode(message, writer, q) {
                if (!writer)
                    writer = $Writer.create();
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                if (message.update != null && Object.hasOwnProperty.call(message, "update"))
                    $root.ovlive.v1.Update.encode(message.update, writer.uint32(/* id 1, wireType 2 =*/10).fork(), q + 1).ldelim();
                if (message.pong != null && Object.hasOwnProperty.call(message, "pong"))
                    writer.uint32(/* id 2, wireType 0 =*/16).bool(message.pong);
                if (message.error != null && Object.hasOwnProperty.call(message, "error"))
                    $root.ovlive.v1.ServerError.encode(message.error, writer.uint32(/* id 3, wireType 2 =*/26).fork(), q + 1).ldelim();
                return writer;
            };

            /**
             * Decodes a ServerMessage message from the specified reader or buffer.
             * @function decode
             * @memberof ovlive.v1.ServerMessage
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {ovlive.v1.ServerMessage} ServerMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            ServerMessage.decode = function decode(reader, length, error, long) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                if (long === undefined)
                    long = 0;
                if (long > $Reader.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.ovlive.v1.ServerMessage();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.update = $root.ovlive.v1.Update.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    case 2: {
                            message.pong = reader.bool();
                            break;
                        }
                    case 3: {
                            message.error = $root.ovlive.v1.ServerError.decode(reader, reader.uint32(), undefined, long + 1);
                            break;
                        }
                    default:
                        reader.skipType(tag & 7, long);
                        break;
                    }
                }
                return message;
            };

            /**
             * Verifies a ServerMessage message.
             * @function verify
             * @memberof ovlive.v1.ServerMessage
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            ServerMessage.verify = function verify(message, long) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    return "maximum nesting depth exceeded";
                let properties = {};
                if (message.update != null && Object.hasOwnProperty.call(message, "update")) {
                    properties.payload = 1;
                    {
                        let error = $root.ovlive.v1.Update.verify(message.update, long + 1);
                        if (error)
                            return "update." + error;
                    }
                }
                if (message.pong != null && Object.hasOwnProperty.call(message, "pong")) {
                    if (properties.payload === 1)
                        return "payload: multiple values";
                    properties.payload = 1;
                    if (typeof message.pong !== "boolean")
                        return "pong: boolean expected";
                }
                if (message.error != null && Object.hasOwnProperty.call(message, "error")) {
                    if (properties.payload === 1)
                        return "payload: multiple values";
                    properties.payload = 1;
                    {
                        let error = $root.ovlive.v1.ServerError.verify(message.error, long + 1);
                        if (error)
                            return "error." + error;
                    }
                }
                return null;
            };

            /**
             * Creates a ServerMessage message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof ovlive.v1.ServerMessage
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {ovlive.v1.ServerMessage} ServerMessage
             */
            ServerMessage.fromObject = function fromObject(object, long) {
                if (object instanceof $root.ovlive.v1.ServerMessage)
                    return object;
                if (!$util.isObject(object))
                    throw TypeError(".ovlive.v1.ServerMessage: object expected");
                if (long === undefined)
                    long = 0;
                if (long > $util.recursionLimit)
                    throw Error("maximum nesting depth exceeded");
                let message = new $root.ovlive.v1.ServerMessage();
                if (object.update != null) {
                    if (!$util.isObject(object.update))
                        throw TypeError(".ovlive.v1.ServerMessage.update: object expected");
                    message.update = $root.ovlive.v1.Update.fromObject(object.update, long + 1);
                }
                if (object.pong != null)
                    message.pong = Boolean(object.pong);
                if (object.error != null) {
                    if (!$util.isObject(object.error))
                        throw TypeError(".ovlive.v1.ServerMessage.error: object expected");
                    message.error = $root.ovlive.v1.ServerError.fromObject(object.error, long + 1);
                }
                return message;
            };

            /**
             * Creates a plain object from a ServerMessage message. Also converts values to other types if specified.
             * @function toObject
             * @memberof ovlive.v1.ServerMessage
             * @static
             * @param {ovlive.v1.ServerMessage} message ServerMessage
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            ServerMessage.toObject = function toObject(message, options, q) {
                if (!options)
                    options = {};
                if (q === undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw Error("max depth exceeded");
                let object = {};
                if (message.update != null && Object.hasOwnProperty.call(message, "update")) {
                    object.update = $root.ovlive.v1.Update.toObject(message.update, options, q + 1);
                    if (options.oneofs)
                        object.payload = "update";
                }
                if (message.pong != null && Object.hasOwnProperty.call(message, "pong")) {
                    object.pong = message.pong;
                    if (options.oneofs)
                        object.payload = "pong";
                }
                if (message.error != null && Object.hasOwnProperty.call(message, "error")) {
                    object.error = $root.ovlive.v1.ServerError.toObject(message.error, options, q + 1);
                    if (options.oneofs)
                        object.payload = "error";
                }
                return object;
            };

            /**
             * Converts this ServerMessage to JSON.
             * @function toJSON
             * @memberof ovlive.v1.ServerMessage
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            ServerMessage.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for ServerMessage
             * @function getTypeUrl
             * @memberof ovlive.v1.ServerMessage
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            ServerMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/ovlive.v1.ServerMessage";
            };

            return ServerMessage;
        })();

        return v1;
    })();

    return ovlive;
})();

export { $root as default };
