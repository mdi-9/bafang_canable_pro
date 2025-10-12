
"use strict";


// https://github.com/jxltom/gs_usb/blob/master/gs_usb/ used to inspiration (thank you!)
// https://github.com/woj76/gs_usb_leonardo/ has some insight into the firmware 
// also https://github.com/candle-usb/candleLight_fw/blob/master/src/usbd_gs_can.c

const usb = require('usb');

const { CanFrame } = require("./canframe.js");

/*
usb.LIBUSB_RECIPIENT_DEVICE 0
usb.LIBUSB_RECIPIENT_INTERFACE 1
usb.LIBUSB_RECIPIENT_ENDPOINT 2
usb.LIBUSB_REQUEST_TYPE_STANDARD 0
usb.LIBUSB_REQUEST_TYPE_CLASS 20
usb.LIBUSB_REQUEST_TYPE_VENDOR 40

LIBUSB_ENDPOINT_OUT = 0x00,

LIBUSB_ENDPOINT_IN = 0x80



*/

class GSUSBConstants {
    // Special address description flags for the CAN_ID
    static CAN_EFF_FLAG = 0x80000000  // EFF/SFF is set in the MSB
    static CAN_RTR_FLAG = 0x40000000  // remote transmission request
    static CAN_ERR_FLAG = 0x20000000  // error message frame

    // Valid bits in CAN ID for frame formats
    static CAN_SFF_MASK = 0x000007FF  // standard frame format (SFF)
    static CAN_EFF_MASK = 0x1FFFFFFF  // extended frame format (EFF)
    static CAN_ERR_MASK = 0x1FFFFFFF  // omit EFF, RTR, ERR flags

    static CAN_SFF_ID_BITS = 11
    static CAN_EFF_ID_BITS = 29

    // CAN payload length and DLC definitions according to ISO 11898-1
    static CAN_MAX_DLC = 8
    static CAN_MAX_DLEN = 8

    // CAN ID length
    static CAN_IDLEN = 4

    // used for filtering
    static GS_USB_DEVICES = [
        {  // gs_usb
            vendorId:0x1D50,
            productId: 0x606F
        },
        { // candelite
            vendorId:0x1209,
            productId: 0x606F
        },
        { //cesCanExtFd
            vendorId:0x1CD2,
            productId: 0x606F
        },
        { //abeCanDebuggerFd
            vendorId:0x16D0,
            productId: 0x10B8
        }
    ];



    /*
     * Control request types.
     */
    static GS_USB_BREQ = {
        host_format:     { request: 0,  len: 4,        read:  true }, // generally not implemented
        bittiming:       { request: 1,  len: 20,       write: true }, // probably write only
        mode:            { request: 2,  len: 8,        write: true },
        berr:            { request: 3,  len: undefined             }, // generally not implemented
        bt_const:        { request: 4,  len: 40,       read:  true },
        device_config:   { request: 5,  len: 12,       read:  true },
        timestamp:       { request: 6,  len: 4,        read:  true },
        identify:        { request: 7,  len: 4,        write: true },
        get_user_id:     { request: 8,  len: undefined             }, // generally not implemented
        set_user_id:     { request: 9,  len: undefined             }, // generally not implemented
        data_bittiming:  { request: 10, len: 20,       write: true }, 
        bt_const_ext:    { request: 11, len: 72                    }, // generally not implemented
        set_termination: { request: 12, len:  4,       write: true },
        get_termination: { request: 13, len: 4,        read:  true },
        get_state:       { request: 14, len: undefined             }, // generally not implemented
        setfilter:       { request: 32, len: 8,        write: true }, // custom firmware required, not standard gs_usb
        readfilter:      { request: 33, len: 8,        read: true  }, // custom firmware required, not standard gs_usb
        readMetrics:     { request: 34, len: 16,        read: true  }, // custom firmware required, not standard gs_usb
    };

    static GS_USB_FILTER_TYPE = {
        pgn: 0,
        source: 1,
        destination: 2,
        resetPgn: 3,
        resetSource: 4,
        resetDestination: 5,
        readPgn: 6,
        readSource: 7,
        readDestination: 8
    };

    /**
     * data endpoints for can frames. 
     * from gs_usb.h 
     * #define GSUSB_ENDPOINT_IN  0x81
     * #define GSUSB_ENDPOINT_OUT 0x02
     */
    static ENDPOINTS = {
        in:  1,  // Endpoint 1   0x81 when ored with directions, see gs_usb.h in FW
        out: 2   // Endpoint 2   0x02 when ored with directions, see gs_usb.h in FW
    };

    // directions
    static LIBUSB_ENDPOINT_IN = 0x80;   // device-> host
    static LIBUSB_ENDPOINT_OUT = 0x00;  // host->device


}



class GSUsb {



/*
From https://github.com/torvalds/linux/blob/master/drivers/net/can/usb/gs_usb.c#L170C1-L183C41
#define GS_CAN_FEATURE_LISTEN_ONLY BIT(0)  
#define GS_CAN_FEATURE_LOOP_BACK BIT(1)
#define GS_CAN_FEATURE_TRIPLE_SAMPLE BIT(2)
#define GS_CAN_FEATURE_ONE_SHOT BIT(3)
#define GS_CAN_FEATURE_HW_TIMESTAMP BIT(4)
#define GS_CAN_FEATURE_IDENTIFY BIT(5)
#define GS_CAN_FEATURE_USER_ID BIT(6)
#define GS_CAN_FEATURE_PAD_PKTS_TO_MAX_PKT_SIZE BIT(7)
#define GS_CAN_FEATURE_FD BIT(8)
#define GS_CAN_FEATURE_REQ_USB_QUIRK_LPC546XX BIT(9)
#define GS_CAN_FEATURE_BT_CONST_EXT BIT(10)
#define GS_CAN_FEATURE_TERMINATION BIT(11)
#define GS_CAN_FEATURE_BERR_REPORTING BIT(12)
#define GS_CAN_FEATURE_GET_STATE BIT(13)
*/


    /*
     * Possible defice flags, not all are supported.
     * check the capabilities.feature bitmap.
     */
    static GS_DEVICE_FLAGS = {
        listenOnly: 0x01,
        loopBack: 0x02,
        tripleSample: 0x04, 
        oneShot: 0x08,
        hwTimeStamp: 0x10,
        identify: 0x20,
        userId: 0x40, 
        padPackets:0x80, 
        fdMode: 0x100,  
        btConstExt: 0x200, 
        termination: 0x400,
        errorReporting: 0x800,
        getState: 0x1000
    };




    constructor() {
        this.gs_usb = undefined;
        this.deviceCapability = undefined;
        this.started = false;

        this._listeners = {};

        this.onUSBPollData = this.onUSBPollData.bind(this);
        this.onUSBPollError = this.onUSBPollError.bind(this);
        this.onUSBPollEnd = this.onUSBPollEnd.bind(this);

    }

        // event emitter
    _emitEvent(name, value) {
        if ( this._listeners[name] !== undefined ) {
            this._listeners[name].forEach(async (f) => { 
                try {
                    await f(value);
                } catch (e) {
                    console.log("Error: failed to deliver event ",name,value,e);
                }
            });
        }
    }

    /**
     * register event handler function
     *
     * Events
     * frame - payload is an frame object
     * canpacket - payload is a DataView of the can packet
     * error - payload is the exception or error object
     * stopped_reading - when the driver stops reading
     *
     */
    on(name, fn) {
        this._listeners[name] = this._listeners[name] || [];
        this._listeners[name].push(fn);
    }

    async checkDevice() {
        console.log("Start check device ===================");
        const webusb = new usb.WebUSB({
            allowAllDevices: true
        });



        this.gs_usb = await webusb.requestDevice({ filters: GSUSBConstants.GS_USB_DEVICES});
        await this.gs_usb.open();
        await this.gs_usb.claimInterface(0);

        console.log("Device ", this.gs_usb.productName);
        console.debug("Configuration ", this.gs_usb.configuration);
        for (var i of  this.gs_usb.device.interfaces) {
            console.log("Interface ", i);

        }



        await this.identify(0);
        await new Promise((resolve) => {
            setTimeout( () => {
                this.identify(1);
                resolve();
            }, 1000 );
        });
        await new Promise((resolve) => {
            setTimeout( () => {
                this.identify(0);
                resolve();
            }, 1000 );
        });

        await this.gs_usb.clearHalt("in", GSUSBConstants.ENDPOINTS.in);
        await this.gs_usb.clearHalt("out", GSUSBConstants.ENDPOINTS.out);


        const out = new DataView(new ArrayBuffer(8));
        out.setUint32(0,0x00, true); // reset 
        out.setUint32(4,this.device_flags, true);

        if ( await this._controlWrite(GSUSBConstants.GS_USB_BREQ.mode, out.buffer)) {
            console.log("Stopped CAN Ok");
            this.started = false;
        } else {
            console.log("Failed to stop");
        }



/*
https://github.com/torvalds/linux/blob/master/drivers/net/can/usb/gs_usb.c#L1435C2-L1440C19
rc = usb_control_msg_recv(udev, 0,
                  GS_USB_BREQ_DEVICE_CONFIG,
                  USB_DIR_IN | USB_TYPE_VENDOR | USB_RECIP_INTERFACE,
                  1, intf->cur_altsetting->desc.bInterfaceNumber,
                  &dconf, sizeof(dconf), 1000,
                  GFP_KERNEL);

*/

        await this.gs_usb.releaseInterface(0);
        await this.gs_usb.reset();
        await this.gs_usb.close();
        this.started = false;

        console.log("End check device ===================");


    }



    /**
     * Start the can device with a bitrate and flags.
     * If started listen only the can device will not send any messages
     * to the bus including no acks. If its the only other device on the bus,
     * then the other sender will see no ack and retry indefinitely.
     * 
     * The device is not setup to emit frame events, to allow the caller to 
     * manage the flow if required.
     */
    async start(bitrate, flags) {
        if (this.stopping ) {
            console.log("Start startup retry in 100ms, stopping in progress ===================");
            setTimeout(async () => {
                await this.start(bitrate, flags);
            }, 100);
        }
        console.log("Start startup ===================");
        const webusb = new usb.WebUSB({
            allowAllDevices: true
        });


        this.gs_usb = undefined;
        try {
            this.gs_usb = await webusb.requestDevice({ filters: GSUSBConstants.GS_USB_DEVICES});
        } catch (e) {
            console.log("GS USB device not found", e);
            return {
                msg: "GS USB device not found",
                e: ""+e,
                ok: false
            };
        }

        console.log("Startup Found  ",this.gs_usb.productName );
        await this.gs_usb.open();
        // allow the device to be stopped after here.
        this.stopping = false;
        await this.gs_usb.reset();





        // can is on config 1, interface 0 has 2 endpoints
        await this.gs_usb.selectConfiguration(1);
        await this.gs_usb.claimInterface(0);

        this.capabilities = await this.readDeviceCapabilities();


        await this._setBitrate(bitrate);




        this.device_flags = (flags || 0) 
            &  this.capabilities.features
            & ( GSUsb.GS_DEVICE_FLAGS.listenOnly 
                | GSUsb.GS_DEVICE_FLAGS.loopBack 
                | GSUsb.GS_DEVICE_FLAGS.oneShot
                | GSUsb.GS_DEVICE_FLAGS.hwTimeStamp );


        if  ((this.device_flags & GSUsb.GS_DEVICE_FLAGS.hwTimeStamp) ==  GSUsb.GS_DEVICE_FLAGS.hwTimeStamp) {
            this.frameLength = 24;
        } else {
            this.frameLength = 20;
        }

        this.frame = new CanFrame(this.frameLength);

        for ( var f in GSUsb.GS_DEVICE_FLAGS ) {
            if ( (this.device_flags & GSUsb.GS_DEVICE_FLAGS[f]) == GSUsb.GS_DEVICE_FLAGS[f] ) {
                console.log(`Flags: ${f} enabled`);
            } else {
                //console.log(`Flags: ${f} disabled`);
            }
        }

        // start the device
        const out = new DataView(new ArrayBuffer(8));
        // uint32 little endian
        out.setUint32(0,0x01, true); // start 
        out.setUint32(4,this.device_flags, true);




        if ( await this._controlWrite(GSUSBConstants.GS_USB_BREQ.mode, out.buffer) ) {
            console.log("Started CAN Ok");
            this.started = true;
            console.log("End startup ===================");

            return {
                ok: true
            };


        } else {
            console.log("GS USB  Failed to start");
            console.log("End startup ===================");
            return {
                msg: "Failed to start",
                ok: false
            };
        }



    }

    /**
     * Stop the can device and close the interface. 
     * The correct sequence is 
     *  stop new transfers
     *  wait for transfers to timeout or complete.
     *  stop the can device.
     *  release the interface
     *  close.
     * 
     * If the can device is not stopped then it continues to receive data which 
     * can be seen from the leds. It then overflows the lists and corrupts itself
     * after which time it has to be power cycled.
     * 
     * However this sequence only works 50% of the time. 
     */
     async stop() {
        console.log("Start stop ===================");
        if (this.stopping ) {
            console.log("End stop (already stopping) ===================");
            return;
        }
        if ( this.gs_usb === undefined ) {
            console.log("No device found");
            this.stopping = false; // Ensure flag is false if no device
            console.log("End stop ===================");
            return;
        }
        this.stopping = true; // Set flag indicating stop is in progress

        // stop new can messages being received by the can interface
        console.log("stop Disable Hardware ===================");
        await this._disableCanHrdware(); // We await this

        // Stop polling first if it's running
        // console.log("Stopping polling if active..."); // Optional log
        await this.stopPolling(); // Await polling stop completion
        // console.log("Polling stopped."); // Optional log


        // Removed the artificial waits, rely on stopPolling and close

        try {
            // console.log("Closing USB device..."); // Optional log
            if (this.gs_usb && typeof this.gs_usb.close === 'function') { // Check if gs_usb exists and has close
                 await this.gs_usb.close(); // Await the close operation
                 // console.log("USB device closed."); // Optional log
            } else {
                 // console.log("No USB device object to close or already closed.");
            }
            this.started = false; // Mark as not started
            this.gs_usb = undefined; // Clear the device reference
            this.stopping = false; // <<< RESET THE FLAG HERE on successful stop
            console.log("End stop (Successful) ===================");
        } catch (e) {
            console.error("Error during USB device close in stop(): ", e);
            // Even on error, consider it stopped and reset flags
            this.started = false;
            this.gs_usb = undefined;
            this.stopping = false; // <<< RESET THE FLAG HERE on error during close
            console.log("End stop (With close error) ===================");
            // Optionally re-throw or handle the error further if needed
        }
    }

    async _disableCanHrdware() {
        const out = new DataView(new ArrayBuffer(8));
        out.setUint32(0,0x00, true); // reset 
        out.setUint32(4,0x00, true); // clear all flags. see defice_flags

        if ( await this._controlWrite(GSUSBConstants.GS_USB_BREQ.mode, out.buffer)) {
            console.log("CAN Hardware disabled.");
        } else {
            console.log("Failed to disable CAN Hardware");
        }        
    }

    /** 
     * Flash the leds in a sequence, if led != 0
     */ 
    async identify(led) {
        const out = new DataView(new ArrayBuffer(4));
        out.setUint32(0,led);
        return await this._controlWrite(GSUSBConstants.GS_USB_BREQ.identify, out.buffer);
    }

    /**
     * read the device capabilities and bit timing constants.
     */
    async readDeviceCapabilities() {
        const data = await this._controlRead(GSUSBConstants.GS_USB_BREQ.bt_const);
        if ( data != undefined ) {
            const capabilities = {
                features: data.getUint32(0,true),
                fclk_can: data.getUint32(4,true),
                tseg1_min: data.getUint32(8,true),
                tseg1_max: data.getUint32(12,true),
                tseg2_min: data.getUint32(16,true),
                tseg2_max: data.getUint32(20,true),
                sjw_max: data.getUint32(24,true),
                brp_min: data.getUint32(28,true),
                brp_max: data.getUint32(32,true),
                brp_inc: data.getUint32(36,true)
            } 
            //console.log("Got Capabilities ", capabilities);
            //this.dumpSupportedFLags(capabilities.features);
            return capabilities;
        } else {
            console.log("Failed to get capabilities ");
            return undefined;
        }
    }
/*
struct gs_metrics {
    u16 main_loop; // count of iterations round the main loop in main.c
    u16 send_to_host; // calls to send to host in main.c
    u16 recv;  // count of frame ready to goto host in main.c
    u16 no_recv; // count of no receive in main.c
    u16 no_pool_frame; // count of no pool frame available in main.c
    u16 error; // count of errors sent to host in main.c
    u16 no_error; // count of times no error was detected.
    u16 spare;
}  __packed __aligned(4);
// 16

*/
    async readMetrics() {
        const data = await this._controlRead(GSUSBConstants.GS_USB_BREQ.readMetrics);
        if ( data != undefined ) {
            return {
                main_loop: data.getUint16(0,true),
                send_to_host: data.getUint16(2,true),
                recv: data.getUint16(4,true),
                no_recv: data.getUint16(6,true),
                no_pool_frame: data.getUint16(8,true),
                error: data.getUint16(10,true),
                no_error: data.getUint16(12,true),
                spare: data.getUint16(14,true),
            }
        } else {
            console.log("Failed to get readMetrics ");
            return undefined;
        }

    }

    /**
     * Dump the flags that are supported in readable form.
     */
    dumpSupportedFLags(features) {
        for (let k in GSUsb.GS_DEVICE_FLAGS) {
            const supported = ((features&GSUsb.GS_DEVICE_FLAGS[k]) === GSUsb.GS_DEVICE_FLAGS[k])?"yes":"no";
            console.log("Feature ",k,supported);
        }
    }


    /**
     * Set the bitrate, must be called before the can interface is started to have any effect.
     */
    async _setBitrate(bitrate) {
        // only supporting 87.5 sample point
        // https://github.com/HubertD/cangaroo/blob/b4a9d6d8db7fe649444d835a76dbae5f7d82c12f/src/driver/CandleApiDriver/CandleApiInterface.cpp#L17-L112

        console.log("Request Set Bitrate to ", bitrate);


/*
from Bosh CAN2.0 Specs can2spec.pdf page 28
| <----------------nominal bit time-----------> |
| sync_seg | prop_seg | phase_seg1 | phase_seg2 |
                                   ^
                                   sample_point

sync_seg = This part of the bit time is used to synchronize the various nodes on the bus. An edge is 
           expected to lie within this segment.
prop_seg = This part of the bit time is used to compensate for the physical delay times within the network
phase_seg1, phase_seg2 = These Phase-Buffer-Segments are used to compensate for edge phase errors. 
                         These segments can be lengthened or shortened by resynchronization.
sample_point = The SAMPLE POINT is the point of time at which the bus level is read and interpreted
               as the value of that respective bit. It’s location is at the end of PHASE_SEG1. 

information_processing_time = time take to process the bit levels 

time_quantum =  is a fixed unit of time derived from the oscillator period. There
                exists a programmable prescaler, with integral values, ranging at least from 1 to 32.
                Starting with the MINIMUM TIME QUANTUM, the TIME QUANTUM can have a length of

                    TIME QUANTUM = m * MINIMUM TIME QUANTUM
                with m the value of the prescaler.     

sync_seg == 1 quantum_time
information_processing_time == <=2 quantum_time

phase_seg1 min = 1, max = 16 from the devices bt configuration (tseg1_min, tseg1_max).
phase_seg2 min = 1, max = 8 from the devices bt configuration (tseg2_min, tseg2_max).
phase_seg2 <= phase_seg1+information processing.
sjw_max = 4
brp_min = 1
brp_max = 1024
brp_inc = 1
fclk_can: 48000000 (eg 48MHz)


what is sjw and brp ?
sjw == synchronisation jum width
brp == bit rate prescalar

The setting are programmed directly into the BTR (CAN_BTR) register. Firmware does not use the HAL calls which 
could be why it wont reset properly without an unplug ????? (idk) CAN_InitTypeDef not used anywhere in the firnware

Firmware checks, hard coded into candleLight, however the return values is not sent back over USB
So we have no idea if were accepted and no way or reading the settings.

bool can_set_bittiming(can_data_t *hcan, uint16_t brp, uint8_t phase_seg1, uint8_t phase_seg2, uint8_t sjw)
{
    if (  (brp>0) && (brp<=1024)
       && (phase_seg1>0) && (phase_seg1<=16)
       && (phase_seg2>0) && (phase_seg2<=8)
       && (sjw>0) && (sjw<=4)
          ) {
        hcan->brp = brp & 0x3FF;
        hcan->phase_seg1 = phase_seg1;
        hcan->phase_seg2 = phase_seg2;
        hcan->sjw = sjw;
        return true;
    } else {
        return false;
    }
}



time_quantum = fclk_can/brp

Using the 250K bit example
Quantum time == 48000000/12 = 4000000 ie 0.25us

250K bit width = 0.000004s == 4us


1+ prop_seg + phase_seg1 + phase_seg2 = 1+1+12+2  = 16 
16*0.25 = 4us


48000000/12*(1+1+12+2)



*/

        if (this.capabilities.fclk_can == 48000000) {


            const timing = {
                prop_seg: 1,
                phase_seg1: 12,
                phase_seg2: 2,
                sjw: 2,   // synchronisation jump width
                brp: 300  // bit rate prescalar
            }
            switch(bitrate) {
                case 10000: timing.brp = 300; break;
                case 20000: timing.brp = 150; break;
                case 50000: timing.brp = 60; break; 
                case 83333: timing.brp = 36; break; 
                case 100000: timing.brp = 30; break; 
                case 125000: timing.brp = 24; break; 
                case 250000: timing.brp = 12; break; 
                case 500000: timing.brp = 6; break; 
                case 800000: 
                 timing.brp = 11; 
                 timing.phase_seg1 = 4;
                 break;
                case 1000000: timing.brp = 3; break;
                default:
                    console.log("Bitrate not supported ",bitrate);
                    return false;
            }

            //const result = this.analyseBittimings(bitrate, timing);
            //console.log("Setting timing", bitrate, this.capabilities, timing, result);
            return await this._setTiming(timing);
        } else if (this.capabilities.fclk_can == 80000000) {
            const timing = {
                prop_seg: 1,
                phase_seg1:12,
                phase_seg2: 2,
                sjw: 1,
                brp: 300
            }
            switch(bitrate) {
                case 10000: timing.brp = 500; break;
                case 20000: timing.brp = 250; break;
                case 50000: timing.brp = 100; break;
                case 83333: timing.brp = 60; break; 
                case 100000: timing.brp = 50; break;
                case 125000: timing.brp = 40; break; 
                case 250000: timing.brp = 20; break;
                case 500000: timing.brp = 10; break;
                case 800000: 
                    timing.phase_seg1 = 7;
                    timing.phase_seg2 = 2;
                    timing.brp = 2;
                    break;
                case 1000000: timing.brp = 2; break;

                default:
                    console.log("Bitrate not supported ",bitrate);
                    return false;
            }
            //const result = this.analyseBittimings(bitrate, timing);
            //console.log("Setting timing", bitrate, this.capabilities, timing, result);
            return await this._setTiming(timing);
        }else if (this.capabilities.fclk_can == 160000000) {
            const timing = {
                prop_seg: 1,
                phase_seg1:12,
                phase_seg2: 2,
                sjw: 1,
                brp: 1000
            }
            switch(bitrate) {
                case 10000: timing.brp = 1000; break;
                case 20000: timing.brp = 500; break;
                case 50000: timing.brp = 200; break;
                case 83333: timing.brp = 120; break;
                case 100000: timing.brp = 100; break;
                case 125000: timing.brp = 80; break;
                case 250000: timing.brp = 40; break;
                case 500000: timing.brp = 20; break;
                case 800000:
                timing.phase_seg1 = 15;
                timing.phase_seg2 = 3;
                timing.brp = 10;
                break;
                case 1000000: timing.brp = 10; break;
                default:
                    console.log("Bitrate not supported ",bitrate);
                    return false;
            }
        }else {
            console.log("Device Clock not supported ",this.capabilities.fclk_can);
            return false;
        }
    }


    /**
     * Analyse timing settings against the bitrate
     * reports various mesaurements.
     */
    analyseBittimings(bitrate, timing) {
        const quiantumTimeUs = (timing.brp*1E6)/this.capabilities.fclk_can;
        const finalBitRate = this.capabilities.fclk_can/(timing.brp*(1+timing.prop_seg+timing.phase_seg1+timing.phase_seg2));
        return {
            quantumTimeUs : quiantumTimeUs,
            finalBitRate: finalBitRate,
            jitterUs: timing.sjw*quiantumTimeUs,
            processingTimeUs: timing.phase_seg2*quiantumTimeUs,
            bitRateError: (finalBitRate-bitrate)/(bitrate),
            samplePoint: (1+timing.prop_seg+timing.phase_seg1)/(1+timing.prop_seg+timing.phase_seg1+timing.phase_seg2)
        };
    }


    /**
     * https://github.com/candle-usb/candleLight_fw/blob/master/src/can.c#L63
     * seg = propagation segment
     * phaseSeg1 = phase segment 1
     * phaseSeg2 = phase segment 2
     * sjw = synchronisation segment
     * brp = precalar wher clock = 48Mhz, see this.capabilities.fclk_can to check, 
     * https://github.com/candle-usb/candleLight_fw/blob/master/src/usbd_gs_can.c#L227C14-L227C29
     * https://github.com/candle-usb/candleLight_fw/blob/master/include/config.h#L59
     * 
     * Message https://github.com/candle-usb/candleLight_fw/blob/master/include/gs_usb.h#L242
     */


    async _setTiming(timing) {

        let valid = true;
        if ( this.started ) {
            console.log("Setting bitrate after started has no effect");
            valid = false;
        }
        if (  (timing.brp < this.capabilities.brp_min ) || (timing.brp > this.capabilities.brp_max ) ) {
            console.log(`Baud rate prescalar incorrect value:${timing.brp} min:${this.capabilities.brp_min} max:${this.capabilities.brp_max}`);
            valid = false;
        }
        if (  (timing.phase_seg1 < this.capabilities.tseg1_min ) || (timing.phase_seg1 > this.capabilities.tseg1_max ) ) {
            console.log(`Phase 1 Segment incorrect value:${timing.phase_seg1} min:${this.capabilities.tseg1_min} max:${this.capabilities.tseg1_max}`);
            valid = false;
        }
        if (  (timing.phase_seg2 < this.capabilities.tseg2_min ) || (timing.phase_seg2 > this.capabilities.tseg2_max ) ) {
            console.log(`Phase 2 Segment incorrect value:${timing.phase_seg2} min:${this.capabilities.tseg2_min} max:${this.capabilities.tseg2_max}`);
            valid = false;
        }
        if (  (timing.sjw < 0 ) || (timing.sjw > this.capabilities.sjw_max ) ) {
            console.log(`Phase 2 Segment incorrect value:${timing.phase_seg2} min:0 max:${this.capabilities.sjw_max}`);
            valid = false;
        }
        if ( valid ) {

/*
            struct gs_device_bittiming {
                u32 prop_seg;
                u32 phase_seg1;
                u32 phase_seg2;
                u32 sjw;
                u32 brp;
            } __packed __aligned(4);
            */

            const out = new DataView(new ArrayBuffer(20));
            out.setUint32(0, timing.prop_seg, true);
            out.setUint32(4, timing.phase_seg1, true);
            out.setUint32(8, timing.phase_seg2, true);
            out.setUint32(12, timing.sjw, true);
            out.setUint32(16, timing.brp, true);
            if ( await this._controlWrite(GSUSBConstants.GS_USB_BREQ.bittiming, out.buffer) ) {
                //console.log("Set all timing Ok");
                return true;
            } else {
                console.log("Failed to set timing");
                return false;
            }


        } else {
            console.log("Not setting bitrate");
            return false;
        }
    }

    /**
     * filters: {
     *   sourceFilter: uint8[],
     *   destinationFilter: uint8[],
     *   pgnFilter: uint32[]
     * }
     * Maximum number of filters is 20 in any class of filter.
     * When filters are defined the message must match at least one from each class.
     * If filters are not defined, the class not checked.
     * 
     * eg if you wanted to only see broadcasts you would set
     * filters: {
     *    destinationFilter: [ 0xff ]
     * }
     * 
     * of if you only wanted to see pgns for rapid engine data from engin on at a source address of 23
     * filters: {
     *    sourceFilter: [ 23 ],
     *    pgnFilter: [ 127488]
     * }
     * 
     * source addresses generally change so filtering like this is not so ousefull.
     */ 

    async setupDeviceFilters(filters) {
/*
struct gs_device_filter {
    u8 filterNum;
    u8 filterType;
    u8 address;
    u8 reserved;
    u32 pgn;
} __packed __aligned(4);


*/

        const out = new DataView(new ArrayBuffer(8));
        if ( filters.sourceFilter ) {
            out.setUint8(0, 0);
            out.setUint8(1, GSUSBConstants.GS_USB_FILTER_TYPE.resetSource);
            out.setUint8(2, 0);
            out.setUint8(3, 0);
            out.setUint32(4, 0);
            if ( ! await this._controlWrite(GSUSBConstants.GS_USB_BREQ.setfilter, out.buffer) ) {
                console.log("Failed to Clear device source filters");
                return false;

            }
            const nFilters = Math.min(filters.sourceFilter.length, 20);
            for (let i = 0; i < nFilters; i++) {
                out.setUint8(0, i);
                out.setUint8(1, GSUSBConstants.GS_USB_FILTER_TYPE.source);
                out.setUint8(2, filters.sourceFilter[i]);
                if ( ! await this._controlWrite(GSUSBConstants.GS_USB_BREQ.setfilter, out.buffer) ) {
                    console.log("Failed to Set device source filters");
                    return false;
                }
            }
        }
        if ( filters.destinationFilter ) {
            out.setUint8(0, 0);
            out.setUint8(1, GSUSBConstants.GS_USB_FILTER_TYPE.resetDestination);
            out.setUint8(2, 0);
            out.setUint8(3, 0);
            out.setUint32(4, 0);
            if ( ! await this._controlWrite(GSUSBConstants.GS_USB_BREQ.setfilter, out.buffer) ) {
                console.log("Failed to Set device destintion filters");
                return false;
            }
            const nFilters = Math.min(filters.destinationFilter.length, 20);
            for (let i = 0; i < nFilters; i++) {
                out.setUint8(0, i);
                out.setUint8(1, GSUSBConstants.GS_USB_FILTER_TYPE.destination);
                out.setUint8(2, filters.destinationFilter[i]);
                if ( ! await this._controlWrite(GSUSBConstants.GS_USB_BREQ.setfilter, out.buffer) ) {
                    console.log("Failed to Set device destintion filters");
                    return false;
                }
            }
        }

        if ( filters.pgnFilter ) {
            out.setUint8(0, 0);
            out.setUint8(1, GSUSBConstants.GS_USB_FILTER_TYPE.resetPgn);
            out.setUint8(2, 0);
            out.setUint8(3, 0);
            out.setUint32(4, 0);
            if ( ! await this._controlWrite(GSUSBConstants.GS_USB_BREQ.setfilter, out.buffer) ) {
                console.log("Failed to Set device pgn filters");
                return false;
            }
            const nFilters = Math.min(filters.pgnFilter.length, 20);
            for (let i = 0; i < nFilters; i++) {
                out.setUint8(0, i);
                out.setUint8(1, GSUSBConstants.GS_USB_FILTER_TYPE.pgn);
                out.setUint32(4, filters.pgnFilter[i], true);
                if ( ! await this._controlWrite(GSUSBConstants.GS_USB_BREQ.setfilter, out.buffer) ) {
                    console.log("Failed to Set device pgn filters");
                    return false;
                }
           }
        }
        console.log("Done setting device filters ");
        return true;

    } 

/*
struct gs_device_filter {
    u8 filterNum;  // the number of the filter read or written, 255 if no more filters on read.
    u8 filterType; // see gs_can_filter_operaton_type
    u8 address;    // address, depending on value of filterType
    u8 nFilters;  // device -> host only, reports the max filternumber of the type in use.
    u32 pgn; // pgn value
} __packed __aligned(4);
*/

    async getDeviceFilters() {

        const filters = {
            nActivePgnFilters: 0,
            nActiveSourceFilters: 0,
            nActiveDestinationFilters: 0,
            pgnFilter: [],
            sourceFilter: [],
            destinationFilter: []

        };
        const readFilter = (data) => {
            if ( data !== undefined ) {
                return {
                    filterNum: data.getUint8(0),
                    filterType: data.getUint8(1),
                    address: data.getUint8(2),
                    nActiveFilters: data.getUint8(3),
                    pgn: data.getUint32(4,true)
                }                
            } else {
                return undefined;
            }
        };

        const readFilterOfType = async (filterType) => {
            const filters = {
                nActiveFilters: 0,
                address: [],
                pgn: []
            };

            const out = new DataView(new ArrayBuffer(8));
            out.setUint8(0, 0); // start at 0
            out.setUint8(1, filterType);
            out.setUint8(2, 0);
            out.setUint8(3, 0);
            out.setUint32(4, 0);
            if ( ! await this._controlWrite(GSUSBConstants.GS_USB_BREQ.setfilter, out.buffer) ) {
                console.log("Failed to Initiate read of device destnation filters");
                return undefined;
            }
            for (var i = 0; i < 255; i++) {
                const filter = readFilter(await this._controlRead(GSUSBConstants.GS_USB_BREQ.readfilter));
                if ( filter === undefined ) {
                    console.log("Failed to read device filter");
                    break;
                } else if ( filter.filterType !== filterType) {
                    console.log("Failed to read device filter, bad type");
                    break;
                } else if ( filter.filterNum === 255 ) {
                    break;
                } else {
                    filters.nActiveFilters = filter.nActiveFilters;
                    filters.address[filter.filterNum] = filter.address;
                    filters.pgn[filter.filterNum] = filter.pgn;
                }
            }
            return filters;
        }

        const pgnFilter = await readFilterOfType(GSUSBConstants.GS_USB_FILTER_TYPE.readPgn);
        if (pgnFilter != undefined) {
            filters.nActivePgnFilters = pgnFilter.nActiveFilters;
            filters.pgnFilter = pgnFilter.pgn;
        }
        const sourceFilter = await readFilterOfType(GSUSBConstants.GS_USB_FILTER_TYPE.readSource);
        if (sourceFilter != undefined) {
            filters.nActiveSourceFilters = sourceFilter.nActiveFilters;
            filters.sourceFilter = sourceFilter.address;
        }
        const destinationFilter = await readFilterOfType(GSUSBConstants.GS_USB_FILTER_TYPE.readDestination);
        if (destinationFilter != undefined) {
            filters.nActiveDestinationFilters = destinationFilter.nActiveFilters;
            filters.destinationFilter = destinationFilter.address;
        }
        return filters;

    }

    /**
     * Get the us timestamp when the frame started.
     */
    async getStartOfFrameTimestampUs() {
        const data = await this._controlRead(GSUSBConstants.GS_USB_BREQ.timestamp);
        if (  data !== undefined ) {
            console.log("Got Frame TS info ", data.getUint32(0, true));
            return data.getUint32(0, true);
        } else {
            console.log("Failed to get Timestamp");
            return undefined;
        }
    }




    /**
     * Write one frame.
     */
    async writeCANFrame(frame) {
        if ( this.gs_usb != undefined ) {
            const result = await this.gs_usb.transferOut(GSUSBConstants.ENDPOINTS.out, frame.toBuffer());
            if ( result.status == "ok") {
                return true;
            } else {
                console.log("Failed to write ", result);
            }

        }
        return false;
    }



    /**
     * Add a filter function, keyed by pgn.
     * If the pdn matches the function will be called with the message header.
     * If if it returns true, the message will be accepted, false will be filtered.
     * If no function is provided the pgn will always be accepted.
     * a pgn of '*' will match all pgs and the function will called.
     * 
     */
    addFilter(pgn, filterFn) {

        if ( this.filters === undefined ) {
            this.filters = {};
        }
        this.filters[pgn] = filterFn || (() => {return true});
    }


    /**
     * returns true if the frame is accepted by the filters.
     */
    _acceptMessage(frame) {
        if (this.filters !== undefined 
            && frame.frameType === "extended"  
            && frame.messageHeader !== undefined ) {
            if ( this.filters[frame.messageHeader.pgn] !== undefined ) {
                if ( this.filters[frame.messageHeader.pgn](frame.messageHeader) ) {
                    return true;
                }
                if ( this.filters['*'] !== undefined ) {
                    if ( this.filters['*'](frame.messageHeader) ) {
                        return true;
                    }
                }
            } else {
                return true;
            }
        } else {
            return true;
        }
    }





    /*
     * Start internal polling buffers to collect data in frames.
     */
    async startPolling() {
        if ( this.gs_usb != undefined && this.started ) {
            //console.log("Reading Frame");
            const endpointId = GSUSBConstants.ENDPOINTS.in | GSUSBConstants.LIBUSB_ENDPOINT_IN;
            this.endpoint = await this.gs_usb.getEndpoint(endpointId);
            if ( this.endpoint == undefined ) {
                console.log("Endpoint doesnt exists", GSUSBConstants.ENDPOINTS.in, GSUSBConstants.LIBUSB_ENDPOINT_IN, endpointId);
                throw new Error("Invalid endpoint");
            }
            const that = this;
            this.endpoint.startPoll(3, 1024);
            that.pollCanFrames = true;

            this.endpoint.on('data', this.onUSBPollData);
            this.endpoint.on('error', this.onUSBPollError);
            this.endpoint.on('end', this.onUSBPollEnd);
            console.log("Polling started");
        } else {
            console.log("gsusb Not started");
        }
    }
    async stopPolling() {
        return new Promise((resolve) => {
            if (this.pollCanFrames && this.endpoint) { // Check if polling was active AND endpoint exists
                this.pollCanFrames = false; // Signal to logic that uses this flag (if any)
                
                const localEndpointRef = this.endpoint; // Capture current endpoint reference
                const that = this;

                // Ensure stopPoll is called on a valid endpoint object
                if (typeof localEndpointRef.stopPoll === 'function') {
                    try {
                        localEndpointRef.stopPoll(() => { // Callback for when node-usb confirms polling stopped
                            // console.log("[GSUsb] stopPoll callback executed.");
                            // Defensive checks before using 'that.endpoint' or 'localEndpointRef'
                            // as they might have been changed or nulled by other async operations.
                            if (that.endpoint === localEndpointRef && that.endpoint) {
                                try {
                                    that.endpoint.off('data', that.onUSBPollData);
                                    that.endpoint.off('error', that.onUSBPollError);
                                    that.endpoint.off('end', that.onUSBPollEnd);
                                } catch (offError) {
                                    console.warn("[GSUsb] Error during endpoint.off():", offError.message);
                                }
                            }
                            that.endpoint = undefined; // Important to clear the reference
                            resolve();
                        });
                    } catch (e) {
                        console.error("[GSUsb] Error calling endpoint.stopPoll():", e.message);
                        // If stopPoll itself throws, cleanup and resolve
                        that.endpoint = undefined;
                        resolve();
                    }
                } else {
                    console.warn("[GSUsb] stopPolling: endpoint.stopPoll is not a function. Endpoint might be invalid.");
                    this.endpoint = undefined; // Clear potentially invalid endpoint
                    resolve();
                }
                // Removed the 10-second backup timeout that called resolve()
                // Rely on stopPoll's callback or an error during its call.
            } else {
                if (!this.pollCanFrames) {
                    // console.log("[GSUsb] stopPolling: Polling was not marked as active (pollCanFrames=false).");
                }
                if (!this.endpoint) {
                    // console.warn("[GSUsb] stopPolling: Endpoint was already undefined.");
                }
                this.pollCanFrames = false; // Ensure flag is consistently false
                this.endpoint = undefined; // Ensure endpoint is cleared
                resolve(); // Resolve if not polling or no endpoint
            }
        });
    }


    /*
     * Process the frame.
     */
    onUSBPollData(data) {
        try {
            const dv = new DataView(data.buffer);
            this._emitEvent("canpacket",dv);
            this.frame.fromBuffer(dv);
            if ( this._acceptMessage(this.frame)) {
                this._emitEvent("frame", this.frame);
            };
        } catch(e) {
            console.log("Failed to process usb data", e);
        }
    }
    /**
     * Typically this causes the polling to stop and not recover.
     */
    onUSBPollError(e) {
        console.log("Polling error ", e);

    }
    /**
     * Done.
     */
    onUSBPollEnd() {
        console.log('done polling');
        this.pollCanFrames = false;
    }




    /**
     * @deprecated use startPolling and stopPolling in preference to reduce CPU usage in most cases.
     * Starts to stream frames emitting "frame" events
     * The frame object is static, so do not rely on it being preserved between events.
     * 
     */
    startStreamingCANFrames() {
        this.streamCanFrames = true
        this._streamCANFrames(this.frame);
    }

    /**
     * @deprecated
     * Stop streaming frames
     */
    async stopStreamingCANFrames() {
        this.streamCanFrames = false;
        return new Promise((resolve) => {
            this.on("stopped_reading", () => {
                console.log("Stopped Reading ok");
                resolve();
            });
            setTimeout(() => {
                console.log("Timeout waiting for reading to stop");
                resolve();
            }, 1000);
        });
    }


    /** @deprecated internal */
    _streamCANFrames(frame) {
        if ( this.started && this.streamCanFrames ) {
            const that = this;
            // not using process.nextTick() to try and keep the code
            // able to run in both chrome and node.
            setTimeout(async () => {
                try {
                    // timeout is 1s, and the call is non blocking as
                    // it goes to libusb lib_transfer_submit which returns immediately to call a callback 
                    // on success, error or timeout. Default timeout is 1s.

                    if ( await that._readCANFrame(frame) ) {
                        if ( that._acceptMessage(frame)) {
                            that._emitEvent("frame", frame);
                        }
                    }               
                } catch (e) {
                    if ( e.message && e.message.includes("LIBUSB_TRANSFER_TIMED_OUT")) {
                        console.log("readCanFrame timeout");
                        that._emitEvent("error",e);
                    } else {
                        console.log("readCanFrame failed ", e);
                        that._emitEvent("error",e);
                    }
                }
                that._streamCANFrames(frame);
            }, 10);            
        } else {
            console.log(`Streaming Ends started:${this.started} streaming:${this.streamCanFrames}`);
            this.streamCanFrames = false;
            this._emitEvent("stopped_reading");
        }
    }

    /**
     * @deprecated
     * Read an populate 1 frame with a 500ms timeout
     * This is a private method, by can be called directly
     */
    async _readCANFrame(frame) {
        if ( this.gs_usb != undefined && this.started ) {
            //console.log("Reading Frame");
            const endpointId = GSUSBConstants.ENDPOINTS.in | GSUSBConstants.LIBUSB_ENDPOINT_IN;
            const endpoint = await this.gs_usb.getEndpoint(endpointId);
            if ( endpoint == undefined ) {
                console.log("Endpoint doesnt exists", GSUSBConstants.ENDPOINTS.in, GSUSBConstants.LIBUSB_ENDPOINT_IN, endpointId);
                throw new Error("Invalid endpoint");
            }
            endpoint.timeout = 500; // 200 ms timeout, required as the default is infinite.
            const result = await this.gs_usb.transferIn(GSUSBConstants.ENDPOINTS.in, frame.frameLength);
            if ( result.status == "ok" ) {
                this._emitEvent("canpacket",result.data);
                frame.fromBuffer(result.data);
                return true;
            } else {
                console.log("Failed to read ", result);
            }          
        }
        return false;
    }

    /**
     * request and read a control message from USB
     * req takes the form { req: requestId, len: expected length, read:  true}
     */
    async _controlRead(req) {
        if ( this.gs_usb !== undefined ) {
            try {
                const result = await this.gs_usb.controlTransferIn({
                    requestType: 'vendor', // 0x40
                    recipient: 'interface', // 0x01 ,, write 0x41
                    request: req.request, // 
                    value: 0,  // channel 0 is the can channel, (1 is DFU for programming)
                    index: 0
                }, req.len);
                if ( result.status == "ok") {
                    return result.data;
                } else {
                    console.log("Failed to read data", req, result);
                }
            } catch (e) {
                if ( req.read ) {
                    console.log("Read failed, firmware bug perhaps ", e);
                } else {
                    console.log("Read failed, read not supported ", e);
                }
            }
        }
        return undefined;
    }
    /**
     * write a control message from the buffer
     * req takes the form { req: requestId, len: expected length, write:  true}
     */
    async _controlWrite(req, buffer) {
        if ( this.gs_usb !== undefined ) {
            try {
                //console.log("Sending ",buffer);
                const result = await this.gs_usb.controlTransferOut({
                    requestType: 'vendor', // 0x40
                    recipient: 'interface', // 0x01 ,, write 0x41
                    request: req.request, // mode request
                    value: 0,  // channel 0 is the can channel, (1 is DFU for programming)
                    index: 0
                }, buffer);
                if ( result.status === "ok" ) {
                    return true;
                } else {
                    console.log("Failed to write",result);
                }
            } catch (e) {
                if ( req.write ) {
                    console.log("Write failed, firmware bug perhaps ", e);
                } else {
                    console.log("Write failed, read not supported ", e);
                }
            }
        }
        return undefined;

    }

    /**
     * get the usb device being used.
     */
    getUSBDevice() {
        return this.gs_usb;
    }

    /**
     * get the usb device info
     */
    async getDeviceInfo() {
        const data = await this._controlRead(GSUSBConstants.GS_USB_BREQ.device_config);
        if ( data != undefined ) {
            const deviceInfo = {
                reserved1: data.getUint8(0, true),
                reserved2: data.getUint8(1, true),
                reserved3: data.getUint8(2, true),
                icount: data.getUint8(3, true),
                fw_version: data.getUint32(4, true),
                hw_version: data.getUint32(8, true)
            }
            console.log("Got device info as ", deviceInfo);
            return deviceInfo;

        } else {
            console.log("Failed to get device info");
            return undefined;
        }
    }



}







module.exports =  { 
    GSUsb
};