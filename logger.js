const { setupLogger } = require('./utils');

class Logger {

    logToFile = null;
    timestamp_start = new Date().getTime()
    intervalTime = 50 //ms
    leadingIdNum = "8";
    logObject = {
        lp: 0,
        timestamp: -1,
        //controller_realtime_0
        remaining_capacity: -1,
        cadence: -1,
        torque: -1,
        //controller_realtime_0
        speed: -1,
        current: -1,
        voltage: -1,
        temperature: -1,
        motor_temperature: -1,
        //display_realtime
        current_assist_level: -1,
        //custom
        power: -1,
        human_power: -1,
        single_trip: -1
    }
    logObjectHeader = {
        lp: "Log Point",
        timestamp: "Timestamp (ms)",
        remaining_capacity: "SOC (%)",
        cadence: "Cadence (rpm)",
        torque: "Torque (mV)",
        speed: "Speed (km/h)",
        current: "Current (A)",
        voltage: "Voltage (V)",
        temperature: "Controller Temp (°C)",
        motor_temperature: "Motor Temp (°C)",
        current_assist_level: "Assist Level",
        power: "Power (W)",
        human_power: "Human Power (W)",
        single_trip: "Distance (km)"
    }

    constructor(canbus, ws=null){
        this.canbus = canbus;
        this.ws = ws;
        this.canbus.on('bafang_data_received',this.bafangDataReceived);
    }

    async logCsvRow(row,sendOverWS = true){
        try {
            let csvRow = row.join(';')
            if(this.logToFile)
                await this.logToFile(csvRow);
            if(sendOverWS && this.ws){
                this.ws.send(csvRow);
            }
        }catch( e ) {
            console.log(e, 'ERROR');
        }
    }

    async setupLogger(){
        this.logToFile = await setupLogger('csv');
    }
    async setupHeader(){
        const rowKeys = Object.values(this.logObjectHeader);
        await this.logCsvRow(rowKeys);
    }

    logIntervalId = null;

    startLogging = () => {
        if (this.logIntervalId) {
            clearInterval(this.logIntervalId);
        }
        this.logIntervalId = setInterval(async () => {
            this.logObject.lp++;
            const rowValues = Object.values(this.logObject);
            if(!rowValues.some(x=>x===-1) && (this.logObject.speed || this.logObject.cadence))
                this.logCsvRow(rowValues);
            await this.sendRawFrameWithRetry("5113200","")
            await this.sendRawFrameWithRetry("5113201","")
        }, this.intervalTime);
    }

    stopLogging = () => {
        if (this.logIntervalId) {
            clearInterval(this.logIntervalId);
            this.logIntervalId = null;
        }
    }
    async sendRawFrameWithRetry(id,data,retries = 3){
        let sent = false;
        let tryCount = 0;
        //this.logMessage(`Sending ID:${this.leadingIdNum+id}`, 'SENT');
        do{
            sent = await this.canbus.sendRawFrame(this.leadingIdNum+id,data);
            if (!sent) {
                this.logMessage(`sendFrame returned false for ID${this.leadingIdNum+id}`, 'ERROR');
                await delay(delayMs);
            }
            tryCount++;
        }while(!sent && tryCount < retries);
    }
    //timestamp0 = 0n
    //timestamp1 = 0n
    bafangDataReceived = (parsedEvent)=>{
        const { type, source, cmdCode, subCode, data, timestamp_us} = parsedEvent
        const timestamp_ms = timestamp_us / 1000n;
        switch(type){
            case 'controller_realtime_0':
                //console.log('p0:',this.timestamp0 - timestamp_ms)
                //this.timestamp0 = timestamp_ms;
                this.logObject.timestamp = timestamp_ms;
                this.logObject.remaining_capacity = data.remaining_capacity;
                this.logObject.cadence = data.cadence;
                this.logObject.torque = data.torque;
                this.logObject.single_trip = data.single_trip;
                this.logObject.human_power = this.calculateHumanPower(data.cadence,data.torque,17);
                break;
            case 'controller_realtime_1':
                //console.log('p1:',this.timestamp1 - timestamp_ms)
                //this.timestamp1 = timestamp_ms;
                this.logObject.timestamp = timestamp_ms;
                this.logObject.speed = data.speed;
                this.logObject.current = data.current;
                this.logObject.voltage = data.voltage;
                this.logObject.temperature = data.temperature;
                this.logObject.motor_temperature = data.motor_temperature;
                this.logObject.power = Number((data.voltage * data.current).toFixed(2));
                break;
            case 'display_realtime':
                this.logObject.timestamp = timestamp_ms;
                this.logObject.current_assist_level = data.current_assist_level
                break
        }
    }

    /**
     * Calculates human power output on an e-bike based on sensor data.
     * * @param {number} cadence - Cadence in RPM (revolutions per minute).
     * @param {number} torqueSensorMV - Voltage reading from the sensor in millivolts (mV).
     * @param {number} crankLengthCm - The physical length of the crank arm in centimeters (cm).
     * @returns {number} Calculated power in Watts (W).
     */
    calculateHumanPower(cadence, torqueSensorMV, crankLengthCm) {
        // 1. Resting Threshold (Offset)
        // Based on your data: 0kg corresponds to 750mV.
        const V_ZERO = 750;
        
        // Return 0 if there is no pressure on the pedals or the bike is stationary.
        if (torqueSensorMV <= V_ZERO || cadence <= 0) {
            return 0;
        }

        // 2. Convert Voltage (mV) to Mass (kg)
        // 200mV = 5kg increment (1kg = 40mV step).
        const massKg = (torqueSensorMV - V_ZERO) / 40;

        // 3. Convert Mass to Force (N)
        // F = m * g (where g is Earth's gravity constant ≈ 9.81 m/s^2).
        const gravityConstant = 9.81;
        const forceN = massKg * gravityConstant;

        // 4. Calculate Torque (Nm)
        // Torque (T) = Force (F) * Crank Length (L). 
        // We convert cm to meters for standard SI units.
        const crankLengthMeters = crankLengthCm / 100;
        const torqueNm = forceN * crankLengthMeters;

        // 5. Convert Cadence to Angular Velocity (rad/s)
        // omega = (RPM * 2 * PI) / 60 seconds.
        const angularVelocity = (cadence * 2 * Math.PI) / 60;

        // 6. Calculate Power (W)
        // Power = Torque * Angular Velocity.
        const powerW = torqueNm * angularVelocity;

        // Return the result rounded to two decimal places.
        return Number(powerW.toFixed(2));
    }

    cleanup(){
        this.canbus.removeListener('bafang_data_received', this.bafangDataReceived);
        this.startLogging()
    }
}

module.exports = Logger;