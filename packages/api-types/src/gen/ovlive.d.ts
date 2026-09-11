import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace ovlive. */
export namespace ovlive {

    /** Namespace v1. */
    namespace v1 {

        /** VehicleType enum. */
        enum VehicleType {
            VEHICLE_TYPE_UNSPECIFIED = 0,
            BUS = 1,
            TRAM = 2,
            METRO = 3,
            TRAIN = 4,
            FERRY = 5
        }

        /** Properties of a Viewport. */
        interface IViewport {

            /** Viewport min_lat */
            min_lat?: (number|null);

            /** Viewport min_lon */
            min_lon?: (number|null);

            /** Viewport max_lat */
            max_lat?: (number|null);

            /** Viewport max_lon */
            max_lon?: (number|null);

            /** Viewport zoom */
            zoom?: (number|null);
        }

        /** Represents a Viewport. */
        class Viewport implements IViewport {

            /**
             * Constructs a new Viewport.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IViewport);

            /** Viewport min_lat. */
            public min_lat: number;

            /** Viewport min_lon. */
            public min_lon: number;

            /** Viewport max_lat. */
            public max_lat: number;

            /** Viewport max_lon. */
            public max_lon: number;

            /** Viewport zoom. */
            public zoom: number;

            /**
             * Encodes the specified Viewport message. Does not implicitly {@link ovlive.v1.Viewport.verify|verify} messages.
             * @param message Viewport message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IViewport, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Viewport message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Viewport
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.Viewport;

            /**
             * Verifies a Viewport message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Viewport message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Viewport
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.Viewport;

            /**
             * Creates a plain object from a Viewport message. Also converts values to other types if specified.
             * @param message Viewport
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.Viewport, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Viewport to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Viewport
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a Filters. */
        interface IFilters {

            /** Filters vehicle_types */
            vehicle_types?: (ovlive.v1.VehicleType[]|null);

            /** Filters dataowners */
            dataowners?: (string[]|null);

            /** Filters search */
            search?: (string|null);
        }

        /** Represents a Filters. */
        class Filters implements IFilters {

            /**
             * Constructs a new Filters.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IFilters);

            /** Filters vehicle_types. */
            public vehicle_types: ovlive.v1.VehicleType[];

            /** Filters dataowners. */
            public dataowners: string[];

            /** Filters search. */
            public search: string;

            /**
             * Encodes the specified Filters message. Does not implicitly {@link ovlive.v1.Filters.verify|verify} messages.
             * @param message Filters message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IFilters, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Filters message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Filters
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.Filters;

            /**
             * Verifies a Filters message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Filters message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Filters
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.Filters;

            /**
             * Creates a plain object from a Filters message. Also converts values to other types if specified.
             * @param message Filters
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.Filters, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Filters to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Filters
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a Subscribe. */
        interface ISubscribe {

            /** Subscribe viewport */
            viewport?: (ovlive.v1.IViewport|null);

            /** Subscribe filters */
            filters?: (ovlive.v1.IFilters|null);

            /** Subscribe pinned */
            pinned?: (string[]|null);
        }

        /** Represents a Subscribe. */
        class Subscribe implements ISubscribe {

            /**
             * Constructs a new Subscribe.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.ISubscribe);

            /** Subscribe viewport. */
            public viewport?: (ovlive.v1.IViewport|null);

            /** Subscribe filters. */
            public filters?: (ovlive.v1.IFilters|null);

            /** Subscribe pinned. */
            public pinned: string[];

            /**
             * Encodes the specified Subscribe message. Does not implicitly {@link ovlive.v1.Subscribe.verify|verify} messages.
             * @param message Subscribe message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.ISubscribe, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Subscribe message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Subscribe
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.Subscribe;

            /**
             * Verifies a Subscribe message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Subscribe message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Subscribe
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.Subscribe;

            /**
             * Creates a plain object from a Subscribe message. Also converts values to other types if specified.
             * @param message Subscribe
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.Subscribe, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Subscribe to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Subscribe
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of an UpdateViewport. */
        interface IUpdateViewport {

            /** UpdateViewport viewport */
            viewport?: (ovlive.v1.IViewport|null);

            /** UpdateViewport filters */
            filters?: (ovlive.v1.IFilters|null);

            /** UpdateViewport pinned */
            pinned?: (string[]|null);
        }

        /** Represents an UpdateViewport. */
        class UpdateViewport implements IUpdateViewport {

            /**
             * Constructs a new UpdateViewport.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IUpdateViewport);

            /** UpdateViewport viewport. */
            public viewport?: (ovlive.v1.IViewport|null);

            /** UpdateViewport filters. */
            public filters?: (ovlive.v1.IFilters|null);

            /** UpdateViewport pinned. */
            public pinned: string[];

            /**
             * Encodes the specified UpdateViewport message. Does not implicitly {@link ovlive.v1.UpdateViewport.verify|verify} messages.
             * @param message UpdateViewport message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IUpdateViewport, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an UpdateViewport message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns UpdateViewport
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.UpdateViewport;

            /**
             * Verifies an UpdateViewport message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an UpdateViewport message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns UpdateViewport
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.UpdateViewport;

            /**
             * Creates a plain object from an UpdateViewport message. Also converts values to other types if specified.
             * @param message UpdateViewport
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.UpdateViewport, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this UpdateViewport to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for UpdateViewport
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a ClientMessage. */
        interface IClientMessage {

            /** ClientMessage subscribe */
            subscribe?: (ovlive.v1.ISubscribe|null);

            /** ClientMessage update_viewport */
            update_viewport?: (ovlive.v1.IUpdateViewport|null);

            /** ClientMessage ping */
            ping?: (boolean|null);
        }

        /** Represents a ClientMessage. */
        class ClientMessage implements IClientMessage {

            /**
             * Constructs a new ClientMessage.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IClientMessage);

            /** ClientMessage subscribe. */
            public subscribe?: (ovlive.v1.ISubscribe|null);

            /** ClientMessage update_viewport. */
            public update_viewport?: (ovlive.v1.IUpdateViewport|null);

            /** ClientMessage ping. */
            public ping?: (boolean|null);

            /** ClientMessage payload. */
            public payload?: ("subscribe"|"update_viewport"|"ping");

            /**
             * Encodes the specified ClientMessage message. Does not implicitly {@link ovlive.v1.ClientMessage.verify|verify} messages.
             * @param message ClientMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IClientMessage, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a ClientMessage message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns ClientMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.ClientMessage;

            /**
             * Verifies a ClientMessage message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a ClientMessage message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns ClientMessage
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.ClientMessage;

            /**
             * Creates a plain object from a ClientMessage message. Also converts values to other types if specified.
             * @param message ClientMessage
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.ClientMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this ClientMessage to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for ClientMessage
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a VehicleState. */
        interface IVehicleState {

            /** VehicleState id */
            id?: (string|null);

            /** VehicleState dataowner */
            dataowner?: (string|null);

            /** VehicleState vehicle_number */
            vehicle_number?: (string|null);

            /** VehicleState line_public_number */
            line_public_number?: (string|null);

            /** VehicleState vehicle_type */
            vehicle_type?: (ovlive.v1.VehicleType|null);

            /** VehicleState operator_name */
            operator_name?: (string|null);

            /** VehicleState lat */
            lat?: (number|null);

            /** VehicleState lon */
            lon?: (number|null);

            /** VehicleState bearing */
            bearing?: (number|null);

            /** VehicleState delay_seconds */
            delay_seconds?: (number|null);

            /** VehicleState delay_known */
            delay_known?: (boolean|null);

            /** VehicleState destination */
            destination?: (string|null);

            /** VehicleState block_code */
            block_code?: (string|null);

            /** VehicleState journey_number */
            journey_number?: (string|null);

            /** VehicleState at_stop */
            at_stop?: (boolean|null);

            /** VehicleState current_stop_id */
            current_stop_id?: (string|null);

            /** VehicleState line_color */
            line_color?: (string|null);

            /** VehicleState line_text_color */
            line_text_color?: (string|null);

            /** VehicleState schedule_positioned */
            schedule_positioned?: (boolean|null);

            /** VehicleState speed_kmh */
            speed_kmh?: (number|null);

            /** VehicleState speed_known */
            speed_known?: (boolean|null);
        }

        /** Represents a VehicleState. */
        class VehicleState implements IVehicleState {

            /**
             * Constructs a new VehicleState.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IVehicleState);

            /** VehicleState id. */
            public id: string;

            /** VehicleState dataowner. */
            public dataowner: string;

            /** VehicleState vehicle_number. */
            public vehicle_number: string;

            /** VehicleState line_public_number. */
            public line_public_number: string;

            /** VehicleState vehicle_type. */
            public vehicle_type: ovlive.v1.VehicleType;

            /** VehicleState operator_name. */
            public operator_name: string;

            /** VehicleState lat. */
            public lat: number;

            /** VehicleState lon. */
            public lon: number;

            /** VehicleState bearing. */
            public bearing: number;

            /** VehicleState delay_seconds. */
            public delay_seconds: number;

            /** VehicleState delay_known. */
            public delay_known: boolean;

            /** VehicleState destination. */
            public destination: string;

            /** VehicleState block_code. */
            public block_code: string;

            /** VehicleState journey_number. */
            public journey_number: string;

            /** VehicleState at_stop. */
            public at_stop: boolean;

            /** VehicleState current_stop_id. */
            public current_stop_id: string;

            /** VehicleState line_color. */
            public line_color: string;

            /** VehicleState line_text_color. */
            public line_text_color: string;

            /** VehicleState schedule_positioned. */
            public schedule_positioned: boolean;

            /** VehicleState speed_kmh. */
            public speed_kmh: number;

            /** VehicleState speed_known. */
            public speed_known: boolean;

            /**
             * Encodes the specified VehicleState message. Does not implicitly {@link ovlive.v1.VehicleState.verify|verify} messages.
             * @param message VehicleState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IVehicleState, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a VehicleState message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns VehicleState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.VehicleState;

            /**
             * Verifies a VehicleState message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a VehicleState message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns VehicleState
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.VehicleState;

            /**
             * Creates a plain object from a VehicleState message. Also converts values to other types if specified.
             * @param message VehicleState
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.VehicleState, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this VehicleState to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for VehicleState
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a VehicleMove. */
        interface IVehicleMove {

            /** VehicleMove id */
            id?: (string|null);

            /** VehicleMove lat */
            lat?: (number|null);

            /** VehicleMove lon */
            lon?: (number|null);

            /** VehicleMove bearing */
            bearing?: (number|null);

            /** VehicleMove delay_seconds */
            delay_seconds?: (number|null);

            /** VehicleMove delay_known */
            delay_known?: (boolean|null);

            /** VehicleMove at_stop */
            at_stop?: (boolean|null);

            /** VehicleMove current_stop_id */
            current_stop_id?: (string|null);

            /** VehicleMove schedule_positioned */
            schedule_positioned?: (boolean|null);

            /** VehicleMove speed_kmh */
            speed_kmh?: (number|null);

            /** VehicleMove speed_known */
            speed_known?: (boolean|null);
        }

        /** Represents a VehicleMove. */
        class VehicleMove implements IVehicleMove {

            /**
             * Constructs a new VehicleMove.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IVehicleMove);

            /** VehicleMove id. */
            public id: string;

            /** VehicleMove lat. */
            public lat: number;

            /** VehicleMove lon. */
            public lon: number;

            /** VehicleMove bearing. */
            public bearing: number;

            /** VehicleMove delay_seconds. */
            public delay_seconds: number;

            /** VehicleMove delay_known. */
            public delay_known: boolean;

            /** VehicleMove at_stop. */
            public at_stop: boolean;

            /** VehicleMove current_stop_id. */
            public current_stop_id: string;

            /** VehicleMove schedule_positioned. */
            public schedule_positioned: boolean;

            /** VehicleMove speed_kmh. */
            public speed_kmh: number;

            /** VehicleMove speed_known. */
            public speed_known: boolean;

            /**
             * Encodes the specified VehicleMove message. Does not implicitly {@link ovlive.v1.VehicleMove.verify|verify} messages.
             * @param message VehicleMove message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IVehicleMove, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a VehicleMove message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns VehicleMove
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.VehicleMove;

            /**
             * Verifies a VehicleMove message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a VehicleMove message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns VehicleMove
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.VehicleMove;

            /**
             * Creates a plain object from a VehicleMove message. Also converts values to other types if specified.
             * @param message VehicleMove
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.VehicleMove, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this VehicleMove to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for VehicleMove
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of an Update. */
        interface IUpdate {

            /** Update entered */
            entered?: (ovlive.v1.IVehicleState[]|null);

            /** Update moved */
            moved?: (ovlive.v1.IVehicleMove[]|null);

            /** Update left */
            left?: (string[]|null);

            /** Update is_snapshot */
            is_snapshot?: (boolean|null);
        }

        /** Represents an Update. */
        class Update implements IUpdate {

            /**
             * Constructs a new Update.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IUpdate);

            /** Update entered. */
            public entered: ovlive.v1.IVehicleState[];

            /** Update moved. */
            public moved: ovlive.v1.IVehicleMove[];

            /** Update left. */
            public left: string[];

            /** Update is_snapshot. */
            public is_snapshot: boolean;

            /**
             * Encodes the specified Update message. Does not implicitly {@link ovlive.v1.Update.verify|verify} messages.
             * @param message Update message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an Update message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Update
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.Update;

            /**
             * Verifies an Update message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an Update message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Update
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.Update;

            /**
             * Creates a plain object from an Update message. Also converts values to other types if specified.
             * @param message Update
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.Update, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Update to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Update
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a ServerError. */
        interface IServerError {

            /** ServerError code */
            code?: (number|null);

            /** ServerError message */
            message?: (string|null);
        }

        /** Represents a ServerError. */
        class ServerError implements IServerError {

            /**
             * Constructs a new ServerError.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IServerError);

            /** ServerError code. */
            public code: number;

            /** ServerError message. */
            public message: string;

            /**
             * Encodes the specified ServerError message. Does not implicitly {@link ovlive.v1.ServerError.verify|verify} messages.
             * @param message ServerError message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IServerError, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a ServerError message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns ServerError
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.ServerError;

            /**
             * Verifies a ServerError message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a ServerError message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns ServerError
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.ServerError;

            /**
             * Creates a plain object from a ServerError message. Also converts values to other types if specified.
             * @param message ServerError
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.ServerError, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this ServerError to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for ServerError
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a ServerMessage. */
        interface IServerMessage {

            /** ServerMessage update */
            update?: (ovlive.v1.IUpdate|null);

            /** ServerMessage pong */
            pong?: (boolean|null);

            /** ServerMessage error */
            error?: (ovlive.v1.IServerError|null);
        }

        /** Represents a ServerMessage. */
        class ServerMessage implements IServerMessage {

            /**
             * Constructs a new ServerMessage.
             * @param [properties] Properties to set
             */
            constructor(properties?: ovlive.v1.IServerMessage);

            /** ServerMessage update. */
            public update?: (ovlive.v1.IUpdate|null);

            /** ServerMessage pong. */
            public pong?: (boolean|null);

            /** ServerMessage error. */
            public error?: (ovlive.v1.IServerError|null);

            /** ServerMessage payload. */
            public payload?: ("update"|"pong"|"error");

            /**
             * Encodes the specified ServerMessage message. Does not implicitly {@link ovlive.v1.ServerMessage.verify|verify} messages.
             * @param message ServerMessage message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: ovlive.v1.IServerMessage, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a ServerMessage message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns ServerMessage
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): ovlive.v1.ServerMessage;

            /**
             * Verifies a ServerMessage message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a ServerMessage message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns ServerMessage
             */
            public static fromObject(object: { [k: string]: any }): ovlive.v1.ServerMessage;

            /**
             * Creates a plain object from a ServerMessage message. Also converts values to other types if specified.
             * @param message ServerMessage
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: ovlive.v1.ServerMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this ServerMessage to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for ServerMessage
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }
}
