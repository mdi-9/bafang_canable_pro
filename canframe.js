"use strict";
const process = require('node:process');

/**
 * Provides handling the can frame received from USB, upto the point where the 
 * CanID is decoded. It does not handle decoding the PGN or handling multi frame messages.
 */ 
class CanFrame {


    constructor(frameLength) {
        this.frameLength = frameLength;
        this.data = new DataView(new ArrayBuffer(8));
        this.echo_id = 0;
        this.can_id = 0;
        this.can_dlc = 0;
        this.channel = 0;
        this.flags = 0;
        this.reserved = 0;
        this.timestamp_us = 0;
        this.errors = {};
    }



    /*
     * Load the frame from a DataView.
     */
    fromBuffer(data) {
        this.echo_id = data.getUint32(0, true);
        this.can_id = data.getUint32(4, true);
        this.can_dlc = data.getUint8(8, true);
        this.channel = data.getUint8(9, true);
        this.flags = data.getUint8(10, true);
        this.reserved = data.getUint8(11, true);
        const ba = [];
        for (let i = 0; i < 8; i++) {
            const b = data.getUint8(12+i, true);
            ba.push(b);
            this.data.setUint8(i,b); // 8 bytes
        }
        if ( this.frameLength === 24 ) {
            this.timestamp_us = data.getUint32(20, true);
        } else {
            this.timestamp_us = process.hrtime.bigint()/BigInt(1000); // Corrected function call and use BigInt division
        }
        this._handleFrame();
    } 

    /*
     * Convert the frame to a buffer
     */
    toBuffer() {
        const data = new DataView(new ArrayBuffer(this.frameLength));
        data.setUint32(0, this.echo_id, true);
        data.setUint32(4, this.can_id, true);
        data.setUint8(8, this.can_dlc, true);
        data.setUint8(9, this.channel, true);
        data.setUint8(10, this.flags, true);
        data.setUint8(11, this.reserved, true);
        for (let i = 0; i < 8; i++) {
            data.setUint8(12+i, this.data.getUint8(i, true)); // 8 bytes
        }
        if ( this.frameLength === 24 ) {
            data.setUint32(20, this.timestamp_us, true);
        }
        return data.buffer;
    }






    /**
     * handle the frame a parse message header if appropriate.
     */
    _handleFrame() {
        if (this.echo_id !== 0xFFFFFFFF ) {
            this.frameType = "echo";
        } else if ( (this.can_id&0x20000000) == 0x20000000) {
            this.frameType = "error";
            this._handleErrorFrame();
        } else if (((this.can_id >> 24)&0x80) == 0x80) {
            // CAN ID is 29 bits long
            // 111 1 1 11111111 11111111 11111111
            //                           -------- Source Addresss 8 bits @0
            //                  -------- PDU specific 8 bits @ 8
            //         -------- PDU Format 8 bits @ 16
            //       - Data Page 1 but @24
            //     - reserved 1 bit @25
            // --- priority (3 bits starting @26)

            // PDU Format < 240 is transmitted with a destination address, which is in 8 bits 8
            // PDU Format 240 > 255 is a broadcast with the Group extension in 8 bits @8.
            const pduFormatBits = (this.can_id >> 16)&0xff;
            const pduSpecificBits = (this.can_id >> 8)&0xff;
            const dataPage = (this.can_id >> 24)&0x01;
            const sourceAddress = this.can_id&0xff;
            const priority = (this.can_id >> 26) & 0x7;

            this.frameType = "extended";
            this.messageHeader = {
                sourceAddress,
                priority
            };

            if (pduFormatBits < 240) {
                /* PDU1 format, the PS contains the destination address */
                this.messageHeader.destination = pduSpecificBits;
                this.messageHeader.pgn = (dataPage<<16) | (pduFormatBits << 8);
            } else {
                /* PDU2 format, the destination is implied global and the PGN is extended */
                this.messageHeader.destination = 0xff;
                this.messageHeader.pgn = (dataPage<<16) | (pduFormatBits << 8) | pduSpecificBits;
            }
        } else {
            this.frameType = "standard";
        }
    }




    _incIfSet(errbm, mask, key, errObj ) {
        if ( ((errbm&mask) === mask)) {
            if ( errObj[key] === undefined ) {
                errObj[key] = 1;
            } else {
                errObj[key]++;
            }
        }
    }
    _incIfEquals(errValue, value, key, errObj ) {
        if ( errValue === value ) {
            if ( errObj[key] === undefined ) {
                errObj[key] = 1;
            } else {
                errObj[key]++;
            }
        }
    }

    _accumulate(errDiff, errObj) {
        errObj = errObj || {};
        for(const k in errDiff) {
            if ( errObj[k] === undefined ) {
                errObj[k] = errDiff[k]
            } else {
                errObj[k] = errObj[k] + errDiff[k];
            }
        }
        return errObj;
    }

    _handleErrorFrame() {

        /*
https://github.com/torvalds/linux/blob/master/include/uapi/linux/can/error.h#L51C1-L61C39
#define CAN_ERR_TX_TIMEOUT   0x00000001U /* TX timeout (by netdevice driver) * /
#define CAN_ERR_LOSTARB      0x00000002U /* lost arbitration    / data[0]    * /
#define CAN_ERR_CRTL         0x00000004U /* controller problems / data[1]    * /
#define CAN_ERR_PROT         0x00000008U /* protocol violations / data[2..3] * /
#define CAN_ERR_TRX          0x00000010U /* transceiver status  / data[4]    * /
#define CAN_ERR_ACK          0x00000020U /* received no ACK on transmission * /
#define CAN_ERR_BUSOFF       0x00000040U /* bus off * /
#define CAN_ERR_BUSERROR     0x00000080U /* bus error (may flood!) * /
#define CAN_ERR_RESTARTED    0x00000100U /* controller restarted * /
#define CAN_ERR_CNT          0x00000200U /* TX error counter / data[6] * /
                     /* RX error counter / data[7] * /


https://github.com/linux-can/can-utils/blob/master/include/linux/can.h#L56
/* special address description flags for the CAN_ID * /
#define CAN_EFF_FLAG 0x80000000U /* EFF/SFF is set in the MSB * /
#define CAN_RTR_FLAG 0x40000000U /* remote transmission request * /
#define CAN_ERR_FLAG 0x20000000U /* error message frame * /

/* valid bits in CAN ID for frame formats * /
#define CAN_SFF_MASK 0x000007FFU /* standard frame format (SFF) * /
#define CAN_EFF_MASK 0x1FFFFFFFU /* extended frame format (EFF) * /
#define CAN_ERR_MASK 0x1FFFFFFFU /* omit EFF, RTR, ERR flags * /


*/


        console.log(`Can ID 0x${this.can_id.toString(16)}`);

        console.log("Can Error detected:")
        if ( (this.can_id&0x01) === 0x01 ) {
            console.log("   TX Timeout");
        }
        if ( (this.can_id&0x02) === 0x02 ) {
/* arbitration lost in bit ... / data[0] * /
#define CAN_ERR_LOSTARB_UNSPEC 0x00   /* unspecified * /
/* else bit number in bitstream */
            console.log(`   Lost Arbitration at bit:${this.data.getUint8(0)}`);
        }
        if ( (this.can_id&0x04) === 0x04 ) {
/* error status of CAN-controller / data[1] * /
#define CAN_ERR_CRTL_UNSPEC      0x00 /* unspecified * /
#define CAN_ERR_CRTL_RX_OVERFLOW 0x01 /* RX buffer overflow * /
#define CAN_ERR_CRTL_TX_OVERFLOW 0x02 /* TX buffer overflow * /
#define CAN_ERR_CRTL_RX_WARNING  0x04 /* reached warning level for RX errors * /
#define CAN_ERR_CRTL_TX_WARNING  0x08 /* reached warning level for TX errors * /
#define CAN_ERR_CRTL_RX_PASSIVE  0x10 /* reached error passive status RX * /
#define CAN_ERR_CRTL_TX_PASSIVE  0x20 /* reached error passive status TX * /
*/
            const errs = this.data.getUint8(1);
            const errObj = {};
            this._incIfEquals(errs, 0x00, "unspecifiedError", errObj );
            this._incIfSet(errs, 0x01, "rxBufferOverflow", errObj );
            this._incIfSet(errs, 0x02, "txBufferOverflow", errObj );
            this._incIfSet(errs, 0x04, "rxWarnLevelReached", errObj );
            this._incIfSet(errs, 0x08, "txWarnLevelReached", errObj );
            this._incIfSet(errs, 0x10, "rxPassiveStatusErr", errObj );
            this._incIfSet(errs, 0x20, "txPassiveStatusErr", errObj );
            this._incIfSet(errs, 0x40, "recovered", errObj );
            this.errors.canController = this._accumulate(errObj, this.errors.canController);
            console.log("   CAN Controller Status     update:",errObj," totals:", this.errors.canController);

        }
        if ( (this.can_id&0x08) === 0x08 ) {
/*
/* error in CAN protocol (type) / data[2] * /
#define CAN_ERR_PROT_UNSPEC   0x00    /* unspecified * /
#define CAN_ERR_PROT_BIT      0x01    /* single bit error * /
#define CAN_ERR_PROT_FORM     0x02    /* frame format error * /
#define CAN_ERR_PROT_STUFF    0x04    /* bit stuffing error * /
#define CAN_ERR_PROT_BIT0     0x08    /* unable to send dominant bit * /
#define CAN_ERR_PROT_BIT1     0x10    /* unable to send recessive bit * /
#define CAN_ERR_PROT_OVERLOAD 0x20    /* bus overload * /
#define CAN_ERR_PROT_ACTIVE   0x40    /* active error announcement * /
#define CAN_ERR_PROT_TX       0x80    /* error occurred on transmission * /
*/
            const errs = this.data.getUint8(2);
            const errObj = {};
            this._incIfEquals(errs, 0x00, "unspecifiedError", errObj );
            this._incIfSet(errs, 0x01, "singleBitError", errObj );
            this._incIfSet(errs, 0x02, "frameFormatError", errObj );
            this._incIfSet(errs, 0x04, "bitStuffingError", errObj );
            this._incIfSet(errs, 0x08, "unableToSendDominantBit", errObj );
            this._incIfSet(errs, 0x10, "unableToReceiveRecessiveBit", errObj );
            this._incIfSet(errs, 0x20, "busOverload", errObj );
            this._incIfSet(errs, 0x40, "activeErrorAnnouncement", errObj );
            this._incIfSet(errs, 0x80, "errorOnTransmission", errObj );
            this.errors.protocolErrorType = this._accumulate(errObj, this.errors.protocolErrorType);
            console.log("   Protocol Error Type         update:",errObj," totals:", this.errors.protocolErrorType);


/* error in CAN protocol (location) / data[3] * /
#define CAN_ERR_PROT_LOC_UNSPEC  0x00 /* unspecified * /
#define CAN_ERR_PROT_LOC_SOF     0x03 /* start of frame * /
#define CAN_ERR_PROT_LOC_ID28_21 0x02 /* ID bits 28 - 21 (SFF: 10 - 3) * /
#define CAN_ERR_PROT_LOC_ID20_18 0x06 /* ID bits 20 - 18 (SFF: 2 - 0 )* /
#define CAN_ERR_PROT_LOC_SRTR    0x04 /* substitute RTR (SFF: RTR) * /
#define CAN_ERR_PROT_LOC_IDE     0x05 /* identifier extension * /
#define CAN_ERR_PROT_LOC_ID17_13 0x07 /* ID bits 17-13 * /
#define CAN_ERR_PROT_LOC_ID12_05 0x0F /* ID bits 12-5 * /
#define CAN_ERR_PROT_LOC_ID04_00 0x0E /* ID bits 4-0 * /
#define CAN_ERR_PROT_LOC_RTR     0x0C /* RTR * /
#define CAN_ERR_PROT_LOC_RES1    0x0D /* reserved bit 1 * /
#define CAN_ERR_PROT_LOC_RES0    0x09 /* reserved bit 0 * /
#define CAN_ERR_PROT_LOC_DLC     0x0B /* data length code * /
#define CAN_ERR_PROT_LOC_DATA    0x0A /* data section * /
#define CAN_ERR_PROT_LOC_CRC_SEQ 0x08 /* CRC sequence * /
#define CAN_ERR_PROT_LOC_CRC_DEL 0x18 /* CRC delimiter  * /
#define CAN_ERR_PROT_LOC_ACK     0x19 /* ACK slot * /
#define CAN_ERR_PROT_LOC_ACK_DEL 0x1B /* ACK delimiter * /
#define CAN_ERR_PROT_LOC_EOF     0x1A /* end of frame * /
#define CAN_ERR_PROT_LOC_INTERM  0x12 /* intermission * /
*/

            // note, early firmware may not implement this.
            const errsLoc = this.data.getUint8(3);
            const errObjLoc = {}; 
            this._incIfEquals(errsLoc, 0x00, "unspecifiedError", errObjLoc );
            this._incIfEquals(errsLoc, 0x03, "startOfFrame", errObjLoc );
            this._incIfEquals(errsLoc, 0x02, "idBits28_21", errObjLoc );
            this._incIfEquals(errsLoc, 0x06, "idBits20_18", errObjLoc );
            this._incIfEquals(errsLoc, 0x04, "substituteRTR", errObjLoc );
            this._incIfEquals(errsLoc, 0x05, "identifiedExtension", errObjLoc );
            this._incIfEquals(errsLoc, 0x07, "idBits17_13", errObjLoc );
            this._incIfEquals(errsLoc, 0x0F, "idBits12_5", errObjLoc );
            this._incIfEquals(errsLoc, 0x0E, "idBits4_0", errObjLoc );
            this._incIfEquals(errsLoc, 0x0C, "RTR", errObjLoc );
            this._incIfEquals(errsLoc, 0x0D, "reservedBit1", errObjLoc );
            this._incIfEquals(errsLoc, 0x09, "reservedBit0", errObjLoc );
            this._incIfEquals(errsLoc, 0x0B, "dataLengthCode", errObjLoc );
            this._incIfEquals(errsLoc, 0x0A, "dataSection", errObjLoc );
            this._incIfEquals(errsLoc, 0x08, "crcSequence", errObjLoc );
            this._incIfEquals(errsLoc, 0x18, "crcDelimiter", errObjLoc );
            this._incIfEquals(errsLoc, 0x19, "ackSlot", errObjLoc );
            this._incIfEquals(errsLoc, 0x1A, "endOfFrame", errObjLoc );
            this._incIfEquals(errsLoc, 0x12, "intermission", errObjLoc );
            this.errors.protocolErrorLocation = this._accumulate(errObjLoc, this.errors.protocolErrorLocation);

            console.log("   Protocol Error Location     update:",errObjLoc,"totals", this.errors.protocolErrorLocation);


        }
        if ( (this.can_id&0x10) === 0x10 ) {

/*
/* error status of CAN-transceiver / data[4] * /
/*                                             CANH CANL * /
#define CAN_ERR_TRX_UNSPEC             0x00 /* 0000 0000 * /
#define CAN_ERR_TRX_CANH_NO_WIRE       0x04 /* 0000 0100 * /
#define CAN_ERR_TRX_CANH_SHORT_TO_BAT  0x05 /* 0000 0101 * /
#define CAN_ERR_TRX_CANH_SHORT_TO_VCC  0x06 /* 0000 0110 * /
#define CAN_ERR_TRX_CANH_SHORT_TO_GND  0x07 /* 0000 0111 * /
#define CAN_ERR_TRX_CANL_NO_WIRE       0x40 /* 0100 0000 * /
#define CAN_ERR_TRX_CANL_SHORT_TO_BAT  0x50 /* 0101 0000 * /
#define CAN_ERR_TRX_CANL_SHORT_TO_VCC  0x60 /* 0110 0000 * /
#define CAN_ERR_TRX_CANL_SHORT_TO_GND  0x70 /* 0111 0000 * /
#define CAN_ERR_TRX_CANL_SHORT_TO_CANH 0x80 /* 1000 0000 * /
*/
            // may not be implementedin candelLite.
            const errs = this.data.getUint8(4); // data[4] per CAN error spec
            const errObj = {};
            this._incIfEquals(errs, 0x00, "unspecified", errObj );
            this._incIfEquals(errs, 0x04, "canHnoWire", errObj );
            this._incIfEquals(errs, 0x05, "canHshortToBat", errObj );
            this._incIfEquals(errs, 0x06, "canHshortToVcc", errObj );
            this._incIfEquals(errs, 0x07, "canHshortToGnd", errObj );
            this._incIfEquals(errs, 0x40, "canLnoWire", errObj );
            this._incIfEquals(errs, 0x50, "canLshortToBat", errObj );
            this._incIfEquals(errs, 0x60, "canLshortToVcc", errObj );
            this._incIfEquals(errs, 0x70, "canLshortToGnd", errObj );
            this._incIfEquals(errs, 0x80, "canLshortToCanH", errObj );
            this.errors.transceiverStatus = this._accumulate(errObj, this.errors.transceiverStatus);

            console.log("   Transceiver Status       update:",errObj, "totals",this.errors.transceiverStatus);

        }
        if ( (this.can_id&0x20) === 0x20 ) {
            console.log(`   no ack`);
        }
        if ( (this.can_id&0x40) === 0x40 ) {
            console.log(`   bus off`);
        }
        if ( (this.can_id&0x80) === 0x80 ) {
            console.log(`   bus error`);
        }
        if ( (this.can_id&0x100) === 0x100 ) {
            console.log(`   controller restarted`);
        }
        if ( (this.can_id&0x200) === 0x200 ) {
            console.log(`   tx errors           count:${this.data.getUint8(6)}`);
            console.log(`   rx errors           count:${this.data.getUint8(7)}`);
        }
    }

}


class GSUSBHostFrame {

    constructor() {
        this.fastPacketSequence = 0;
    }
        /**
     * The format of the frames is the same format as recieved from
     * the candellight firmware.  see gs_host_frame.
     */ 
    generate(frameDef, source, destination, timestamp_us) {
        const frames = [];
        if ( frameDef.fastPacket ) {
            // generate the frames as fastpackets.
            const can_id = this.getCanId(frameDef, source, destination);
            let frame = 0;
            let offset = 0;
            this.fastPacketSequence++;
            if ( this.fastPacketSequence > 7 ) {
                this.fastPacketSequence = 0;
            }
            while(offset < frameDef.data.byteLength) {
                const data = new DataView(new ArrayBuffer(24));
                data.setUint32(0, 0xFFFFFFFF, true);
                data.setUint32(4, can_id, true);
                data.setUint8(8, 8, true); // dlc
                data.setUint8(9, 0, true); // channel
                data.setUint8(10, 0, true); // flags
                data.setUint8(11, 0, true); // reserved
                // standard can data.
                data.setUint8(12, (this.fastPacketSequence<<5) | frame++); 
                for (let i = 0; i < 7; i++) {
                    if ( offset < frameDef.data.byteLength ) {
                        data.setUint8(13+i, frameDef.data.getUint8(offset));
                        offset++
                    } else {
                        data.setUint8(13+i, 0xff);
                    }
                }
                data.setUint32(20, timestamp_us, true);
                frames.push(data);
            }
        } else {
            const data = new DataView(new ArrayBuffer(24));
            data.setUint32(0, 0xFFFFFFFF, true);
            data.setUint32(4, this.getCanId(frameDef, source, destination), true);
            data.setUint8(8, 8, true); // dlc
            data.setUint8(9, 0, true); // channel
            data.setUint8(10, 0, true); // flags
            data.setUint8(11, 0, true); // reserved
            // standard can data.
            for (let i = 0; i < 8; i++) {
                data.setUint8(12+i, frameDef.data.getUint8(i, true)); // 8 bytes
            }
            data.setUint32(20, timestamp_us, true);
            frames.push(data);
        }
        return frames;
    }

    getCanId(frameDef, source, destination) {
        const canIdPF = (frameDef.pgn >> 8) & 0xff;
        const extendedFrameBit = (frameDef.type === "extended")?0x80000000:0x00;
        if ( canIdPF < 240 ) { // PDU1 format
            if ( (frameDef.pgn&0xff) != 0 ) {
                return 0;
            } else {
                return ((frameDef.priority&0x7)<<26) 
                        | frameDef.pgn<<8 
                        | frameDef.destination<<8
                        | extendedFrameBit;
            }
        } else { // PDU2 format
            return ((frameDef.priority&0x7)<<26) 
                    | frameDef.pgn<<8 
                    | frameDef.source
                    | extendedFrameBit;
        }
    }

}


module.exports =  { 
    CanFrame,
    GSUSBHostFrame
};