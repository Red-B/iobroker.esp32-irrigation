'use strict';

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

const utils = require('@iobroker/adapter-core');
const axios = require('axios');

class Esp32Irrigation extends utils.Adapter {

    /**
     * Handle messages from admin UI
     */
    async onMessage(obj) {
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'testConnection') {
                const result = await this.testConnectionFromAdmin(obj.message);
                if (obj.callback) this.sendTo(obj.from, obj.command, result, obj.callback);
                return true;
            }
        }
    }

    /**
     * Test connection from admin interface
     */
    async testConnectionFromAdmin(config) {
        try {
            const baseUrl = `http://${config.host}:${config.port}`;
            const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
            
            const response = await axios({
                method: 'GET',
                url: baseUrl + '/api/status',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            if (response.data) {
                return {
                    error: null,
                    result: 'Connection successful! ESP32 is responding correctly.'
                };
            }
        } catch (error) {
            let message = 'Connection failed: ';
            if (error.response) {
                if (error.response.status === 401) {
                    message += 'Authentication error - check username and password';
                } else {
                    message += `HTTP ${error.response.status} - ${error.response.statusText}`;
                }
            } else if (error.code === 'ECONNREFUSED') {
                message += 'Connection refused - check IP address and port';
            } else if (error.code === 'ETIMEDOUT') {
                message += 'Connection timeout - device not reachable';
            } else {
                message += error.message;
            }
            
            return {
                error: message,
                result: null
            };
        }
    }

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'esp32-irrigation',
        });
        
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
        
        this.updateInterval = null;
        this.isConnected = false;
        this.baseUrl = '';
        this.auth = '';
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        this.log.info('ESP32 Irrigation Adapter starting...');

        // Reset connection indicator
        this.setState('info.connection', false, true);

        // Read configuration
        const host = this.config.host || '192.168.1.100';
        const port = this.config.port || 80;
        const username = this.config.username || 'admin';
        const password = this.config.password || 'irrigation';
        const interval = this.config.interval || 30; // seconds

        this.baseUrl = `http://${host}:${port}`;
        this.auth = Buffer.from(`${username}:${password}`).toString('base64');

        this.log.info(`Connecting to ESP32 at ${this.baseUrl}`);

        // Create state objects
        await this.createStateObjects();

        // Test connection
        await this.testConnection();

        if (this.isConnected) {
            // Start periodic updates
            this.updateInterval = setInterval(async () => {
                await this.updateAllStates();
            }, interval * 1000);

            // Initial data load
            await this.updateAllStates();
            
            // Load system information once at startup
            await this.updateSystemInfo();
        }

        // Subscribe to relevant states for writing
        this.subscribeStates('control.*');
        this.subscribeStates('config.*');
        this.subscribeStates('schedule.*');
        this.subscribeStates('actions.*');
    }

    /**
     * Test connection to ESP32
     */
    async testConnection() {
        try {
            const response = await this.apiRequest('/api/status');
            if (response) {
                this.isConnected = true;
                this.setState('info.connection', true, true);
                this.log.info('Successfully connected to ESP32 Irrigation System');
            }
        } catch (error) {
            this.isConnected = false;
            this.setState('info.connection', false, true);
            this.log.error(`Connection failed: ${error.message}`);
        }
    }

    /**
     * Make API request to ESP32
     */
    async apiRequest(endpoint, method = 'GET', data = null, contentType = 'application/json') {
        try {
            const config = {
                method: method,
                url: this.baseUrl + endpoint,
                headers: {
                    'Authorization': `Basic ${this.auth}`,
                    'Content-Type': contentType
                },
                timeout: 10000
            };

            if (data && (method === 'POST' || method === 'PUT')) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
        } catch (error) {
            if (error.response) {
                this.log.error(`API Error ${error.response.status}: ${error.response.statusText}`);
            } else {
                this.log.error(`Network Error: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Create all state objects
     */
    async createStateObjects() {
        // Info states
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Connection status',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false
            },
            native: {}
        });

        // Sensor states
        await this.setObjectNotExistsAsync('sensors.soilMoisture', {
            type: 'state',
            common: {
                name: 'Soil Moisture',
                type: 'number',
                role: 'value.humidity',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('sensors.soilTemperature', {
            type: 'state',
            common: {
                name: 'Soil Temperature',
                type: 'number',
                role: 'value.temperature',
                unit: '°C',
                read: true,
                write: false
            },
            native: {}
        });

        // Status states
        await this.setObjectNotExistsAsync('status.relay1Active', {
            type: 'state',
            common: {
                name: 'Relay 1 Active',
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('status.relay2Active', {
            type: 'state',
            common: {
                name: 'Relay 2 Active',
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('status.irrigationInProgress', {
            type: 'state',
            common: {
                name: 'Irrigation in Progress',
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('status.nextIrrigation', {
            type: 'state',
            common: {
                name: 'Next Irrigation',
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('status.uptime', {
            type: 'state',
            common: {
                name: 'System Uptime',
                type: 'number',
                role: 'value',
                unit: 'ms',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('status.manualIrrigation1', {
            type: 'state',
            common: {
                name: 'Manual Irrigation Channel 1 Active',
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('status.manualIrrigation2', {
            type: 'state',
            common: {
                name: 'Manual Irrigation Channel 2 Active',
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('status.quickWateringActive', {
            type: 'state',
            common: {
                name: 'Quick Watering Active',
                type: 'boolean',
                role: 'indicator.working',
                read: true,
                write: false
            },
            native: {}
        });

        // Control states
        await this.setObjectNotExistsAsync('control.relay1', {
            type: 'state',
            common: {
                name: 'Control Relay 1',
                type: 'boolean',
                role: 'switch',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('control.relay2', {
            type: 'state',
            common: {
                name: 'Control Relay 2',
                type: 'boolean',
                role: 'switch',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('control.pauseDays', {
            type: 'state',
            common: {
                name: 'Pause Days',
                type: 'number',
                role: 'value',
                min: 0,
                max: 365,
                read: true,
                write: true
            },
            native: {}
        });

        // Config states
        await this.setObjectNotExistsAsync('config.moistureThreshold', {
            type: 'state',
            common: {
                name: 'Moisture Threshold',
                type: 'number',
                role: 'value',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('config.dstEnabled', {
            type: 'state',
            common: {
                name: 'DST Enabled',
                type: 'boolean',
                role: 'switch',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('config.pauseUntil', {
            type: 'state',
            common: {
                name: 'Pause Until',
                type: 'number',
                role: 'value.time',
                read: true,
                write: false
            },
            native: {}
        });

        // System Info states
        await this.setObjectNotExistsAsync('info.softwareVersion', {
            type: 'state',
            common: {
                name: 'Software Version',
                type: 'string',
                role: 'info.version',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.buildDate', {
            type: 'state',
            common: {
                name: 'Build Date',
                type: 'string',
                role: 'info.date',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.freeHeap', {
            type: 'state',
            common: {
                name: 'Free Heap Memory',
                type: 'number',
                role: 'value',
                unit: 'bytes',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.totalHeap', {
            type: 'state',
            common: {
                name: 'Total Heap Memory',
                type: 'number',
                role: 'value',
                unit: 'bytes',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.chipModel', {
            type: 'state',
            common: {
                name: 'Chip Model',
                type: 'string',
                role: 'info.hardware',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.chipRevision', {
            type: 'state',
            common: {
                name: 'Chip Revision',
                type: 'number',
                role: 'info.hardware',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.cpuFreqMHz', {
            type: 'state',
            common: {
                name: 'CPU Frequency',
                type: 'number',
                role: 'value',
                unit: 'MHz',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.flashChipSize', {
            type: 'state',
            common: {
                name: 'Flash Chip Size',
                type: 'number',
                role: 'value',
                unit: 'bytes',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.macAddress', {
            type: 'state',
            common: {
                name: 'MAC Address',
                type: 'string',
                role: 'info.mac',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('info.ipAddress', {
            type: 'state',
            common: {
                name: 'IP Address',
                type: 'string',
                role: 'info.ip',
                read: true,
                write: false
            },
            native: {}
        });

        // Schedule states for each day
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
        
        for (let i = 0; i < 7; i++) {
            const day = days[i];
            const dayName = dayNames[i];
            
            await this.setObjectNotExistsAsync(`schedule.${day}.enabled`, {
                type: 'state',
                common: {
                    name: `${dayName} Enabled`,
                    type: 'boolean',
                    role: 'switch',
                    read: true,
                    write: true
                },
                native: {}
            });

            await this.setObjectNotExistsAsync(`schedule.${day}.hour`, {
                type: 'state',
                common: {
                    name: `${dayName} Hour`,
                    type: 'number',
                    role: 'value',
                    min: 0,
                    max: 23,
                    read: true,
                    write: true
                },
                native: {}
            });

            await this.setObjectNotExistsAsync(`schedule.${day}.minute`, {
                type: 'state',
                common: {
                    name: `${dayName} Minute`,
                    type: 'number',
                    role: 'value',
                    min: 0,
                    max: 59,
                    read: true,
                    write: true
                },
                native: {}
            });

            await this.setObjectNotExistsAsync(`schedule.${day}.duration1`, {
                type: 'state',
                common: {
                    name: `${dayName} Duration Channel 1`,
                    type: 'number',
                    role: 'value',
                    unit: 'min',
                    min: 0,
                    max: 30,
                    read: true,
                    write: true
                },
                native: {}
            });

            await this.setObjectNotExistsAsync(`schedule.${day}.duration2`, {
                type: 'state',
                common: {
                    name: `${dayName} Duration Channel 2`,
                    type: 'number',
                    role: 'value',
                    unit: 'min',
                    min: 0,
                    max: 30,
                    read: true,
                    write: true
                },
                native: {}
            });
        }

        // Action states
        await this.setObjectNotExistsAsync('actions.saveConfig', {
            type: 'state',
            common: {
                name: 'Save Configuration',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.refreshData', {
            type: 'state',
            common: {
                name: 'Refresh Data',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.startManualIrrigation1', {
            type: 'state',
            common: {
                name: 'Start Manual Irrigation Channel 1',
                type: 'number',
                role: 'value',
                min: 1,
                max: 10,
                unit: 'min',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.startManualIrrigation2', {
            type: 'state',
            common: {
                name: 'Start Manual Irrigation Channel 2',
                type: 'number',
                role: 'value',
                min: 1,
                max: 10,
                unit: 'min',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.stopManualIrrigation1', {
            type: 'state',
            common: {
                name: 'Stop Manual Irrigation Channel 1',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.stopManualIrrigation2', {
            type: 'state',
            common: {
                name: 'Stop Manual Irrigation Channel 2',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.quickWatering', {
            type: 'state',
            common: {
                name: 'Start Quick Watering',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.updateSystemInfo', {
            type: 'state',
            common: {
                name: 'Update System Information',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        // History channel and states
        await this.setObjectNotExistsAsync('history', {
            type: 'channel',
            common: {
                name: 'History Data'
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('history.lastSensorUpdate', {
            type: 'state',
            common: {
                name: 'Last Sensor History Update',
                type: 'number',
                role: 'value.time',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('history.lastIrrigationEvent', {
            type: 'state',
            common: {
                name: 'Last Irrigation Event',
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.getSensorHistory', {
            type: 'state',
            common: {
                name: 'Get Sensor History',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        await this.setObjectNotExistsAsync('actions.getIrrigationHistory', {
            type: 'state',
            common: {
                name: 'Get Irrigation History',
                type: 'boolean',
                role: 'button',
                read: true,
                write: true
            },
            native: {}
        });

        this.log.info('State objects created successfully');
    }

    /**
     * Update all states from ESP32
     */
    async updateAllStates() {
        try {
            // Update status
            await this.updateStatus();
            
            // Update configuration
            await this.updateConfig();
            
            this.setState('info.connection', true, true);
        } catch (error) {
            this.log.error(`Failed to update states: ${error.message}`);
            this.setState('info.connection', false, true);
        }
    }

    /**
     * Update status states
     */
    async updateStatus() {
        try {
            const status = await this.apiRequest('/api/status');
            if (status) {
                await this.setStateAsync('sensors.soilMoisture', status.soilMoisture, true);
                await this.setStateAsync('sensors.soilTemperature', status.soilTemperature, true);
                await this.setStateAsync('status.relay1Active', status.relay1, true);
                await this.setStateAsync('status.relay2Active', status.relay2, true);
                await this.setStateAsync('status.irrigationInProgress', status.irrigationInProgress, true);
                await this.setStateAsync('status.nextIrrigation', status.nextIrrigation, true);
                await this.setStateAsync('status.uptime', status.uptime, true);
                
                // Update extended status states
                await this.setStateAsync('status.manualIrrigation1', status.manualIrrigation1 || false, true);
                await this.setStateAsync('status.manualIrrigation2', status.manualIrrigation2 || false, true);
                await this.setStateAsync('status.quickWateringActive', status.quickWateringActive || false, true);
                
                // Update control states to reflect current status
                await this.setStateAsync('control.relay1', status.relay1, true);
                await this.setStateAsync('control.relay2', status.relay2, true);
            }
        } catch (error) {
            this.log.error(`Failed to update status: ${error.message}`);
        }
    }

    /**
     * Update configuration states
     */
    async updateConfig() {
        try {
            const config = await this.apiRequest('/api/config');
            if (config) {
                await this.setStateAsync('config.moistureThreshold', config.moistureThreshold, true);
                await this.setStateAsync('config.dstEnabled', config.dstEnabled, true);
                await this.setStateAsync('config.pauseUntil', config.pauseUntil, true);
                
                // Update schedule states
                const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                
                if (config.schedule && Array.isArray(config.schedule)) {
                    for (let i = 0; i < 7 && i < config.schedule.length; i++) {
                        const day = days[i];
                        const schedule = config.schedule[i];
                        
                        await this.setStateAsync(`schedule.${day}.enabled`, schedule.enabled, true);
                        await this.setStateAsync(`schedule.${day}.hour`, schedule.hour, true);
                        await this.setStateAsync(`schedule.${day}.minute`, schedule.minute, true);
                        await this.setStateAsync(`schedule.${day}.duration1`, schedule.duration1, true);
                        await this.setStateAsync(`schedule.${day}.duration2`, schedule.duration2, true);
                    }
                }
            }
        } catch (error) {
            this.log.error(`Failed to update config: ${error.message}`);
        }
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload(callback) {
        try {
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }
            
            this.log.info('ESP32 Irrigation Adapter stopped');
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     */
    async onStateChange(id, state) {
        if (state && !state.ack) {
            this.log.info(`State ${id} changed: ${state.val} (ack = ${state.ack})`);

            try {
                const idParts = id.split('.');
                const stateName = idParts.slice(-1)[0];
                const category = idParts.slice(-2, -1)[0];
                
                switch (category) {
                    case 'control':
                        await this.handleControlChange(stateName, state.val);
                        break;
                    case 'config':
                        await this.handleConfigChange(stateName, state.val);
                        break;
                    case 'schedule':
                        await this.handleScheduleChange(id, state.val);
                        break;
                    case 'actions':
                        await this.handleActionChange(stateName, state.val);
                        break;
                }
            } catch (error) {
                this.log.error(`Error handling state change for ${id}: ${error.message}`);
            }
        }
    }

    /**
     * Handle control state changes
     */
    async handleControlChange(stateName, value) {
        switch (stateName) {
            case 'relay1':
            case 'relay2':
                const channel = stateName === 'relay1' ? 1 : 2;
                await this.controlRelay(channel, value);
                break;
            case 'pauseDays':
                await this.setPause(value);
                break;
        }
    }

    /**
     * Handle config state changes
     */
    async handleConfigChange(stateName, value) {
        // Config changes are handled when saveConfig action is triggered
        this.log.info(`Config ${stateName} changed to ${value} - use saveConfig action to apply`);
    }

    /**
     * Handle schedule state changes
     */
    async handleScheduleChange(id, value) {
        // Schedule changes are handled when saveConfig action is triggered
        this.log.info(`Schedule ${id} changed to ${value} - use saveConfig action to apply`);
    }

    /**
     * Handle action state changes
     */
    async handleActionChange(stateName, value) {
        if (value) {
            switch (stateName) {
                case 'saveConfig':
                    await this.saveConfiguration();
                    break;
                case 'refreshData':
                    await this.updateAllStates();
                    break;
                case 'stopManualIrrigation1':
                    await this.stopManualIrrigation(1);
                    break;
                case 'stopManualIrrigation2':
                    await this.stopManualIrrigation(2);
                    break;
                case 'quickWatering':
                    await this.startQuickWatering();
                    break;
                case 'updateSystemInfo':
                    await this.updateSystemInfo();
                    break;
                case 'getSensorHistory':
                    await this.getSensorHistory();
                    break;
                case 'getIrrigationHistory':
                    await this.getIrrigationHistory();
                    break;
                case 'startManualIrrigation1':
                    if (typeof value === 'number' && value > 0 && value <= 10) {
                        await this.startManualIrrigation(1, value);
                    }
                    break;
                case 'startManualIrrigation2':
                    if (typeof value === 'number' && value > 0 && value <= 10) {
                        await this.startManualIrrigation(2, value);
                    }
                    break;
            }
            
            // Reset action state
            if (stateName !== 'startManualIrrigation1' && stateName !== 'startManualIrrigation2') {
                await this.setStateAsync(`actions.${stateName}`, false, true);
            } else {
                await this.setStateAsync(`actions.${stateName}`, 0, true);
            }
        }
    }

    /**
     * Control relay
     */
    async controlRelay(channel, state) {
        try {
            const formData = new URLSearchParams();
            formData.append('channel', channel.toString());
            formData.append('state', state.toString());
            
            const result = await this.apiRequest('/api/relay', 'POST', formData.toString(), 'application/x-www-form-urlencoded');
            
            if (result && result.success) {
                this.log.info(`Relay ${channel} set to ${state}`);
                // Acknowledge the state change
                await this.setStateAsync(`control.relay${channel}`, state, true);
                
                // Update status to reflect change
                setTimeout(async () => {
                    await this.updateStatus();
                }, 1000);
            }
        } catch (error) {
            this.log.error(`Failed to control relay ${channel}: ${error.message}`);
        }
    }

    /**
     * Set pause
     */
    async setPause(days) {
        try {
            const formData = new URLSearchParams();
            formData.append('days', days.toString());
            
            const result = await this.apiRequest('/api/pause', 'POST', formData.toString(), 'application/x-www-form-urlencoded');
            
            if (result && result.success) {
                this.log.info(`Irrigation paused for ${days} days`);
                await this.setStateAsync('control.pauseDays', days, true);
                
                // Update config to reflect pause
                setTimeout(async () => {
                    await this.updateConfig();
                }, 1000);
            }
        } catch (error) {
            this.log.error(`Failed to set pause: ${error.message}`);
        }
    }

    /**
     * Start manual irrigation
     */
    async startManualIrrigation(channel, duration) {
        try {
            const formData = new URLSearchParams();
            formData.append('channel', channel.toString());
            formData.append('duration', duration.toString());
            
            const result = await this.apiRequest('/api/manual-irrigation', 'POST', formData.toString(), 'application/x-www-form-urlencoded');
            
            if (result && result.success) {
                this.log.info(`Manual irrigation channel ${channel} started for ${duration} minutes`);
                
                // Update status to reflect change
                setTimeout(async () => {
                    await this.updateStatus();
                }, 1000);
            }
        } catch (error) {
            this.log.error(`Failed to start manual irrigation channel ${channel}: ${error.message}`);
        }
    }

    /**
     * Stop manual irrigation
     */
    async stopManualIrrigation(channel) {
        try {
            const formData = new URLSearchParams();
            formData.append('channel', channel.toString());
            
            const result = await this.apiRequest('/api/stop-manual', 'POST', formData.toString(), 'application/x-www-form-urlencoded');
            
            if (result && result.success) {
                this.log.info(`Manual irrigation channel ${channel} stopped`);
                
                // Update status to reflect change
                setTimeout(async () => {
                    await this.updateStatus();
                }, 1000);
            }
        } catch (error) {
            this.log.error(`Failed to stop manual irrigation channel ${channel}: ${error.message}`);
        }
    }

    /**
     * Start quick watering
     */
    async startQuickWatering() {
        try {
            const result = await this.apiRequest('/api/quick-watering', 'POST');
            
            if (result && result.success) {
                this.log.info('Quick watering started (both channels for 5 minutes each)');
                
                // Update status to reflect change
                setTimeout(async () => {
                    await this.updateStatus();
                }, 1000);
            }
        } catch (error) {
            this.log.error(`Failed to start quick watering: ${error.message}`);
        }
    }

    /**
     * Update system information
     */
    async updateSystemInfo() {
        try {
            const systemInfo = await this.apiRequest('/api/system-info');
            if (systemInfo) {
                await this.setStateAsync('info.softwareVersion', systemInfo.version || 'Unknown', true);
                await this.setStateAsync('info.buildDate', systemInfo.buildDate || 'Unknown', true);
                await this.setStateAsync('info.freeHeap', systemInfo.freeHeap || 0, true);
                await this.setStateAsync('info.totalHeap', systemInfo.totalHeap || 0, true);
                await this.setStateAsync('info.chipModel', systemInfo.chipModel || 'Unknown', true);
                await this.setStateAsync('info.chipRevision', systemInfo.chipRevision || 0, true);
                await this.setStateAsync('info.cpuFreqMHz', systemInfo.cpuFreqMHz || 0, true);
                await this.setStateAsync('info.flashChipSize', systemInfo.flashChipSize || 0, true);
                await this.setStateAsync('info.macAddress', systemInfo.macAddress || 'Unknown', true);
                await this.setStateAsync('info.ipAddress', systemInfo.ipAddress || 'Unknown', true);
                
                this.log.info('System information updated');
            }
        } catch (error) {
            this.log.error(`Failed to update system info: ${error.message}`);
        }
    }

    /**
     * Get sensor history
     */
    async getSensorHistory() {
        try {
            const history = await this.apiRequest('/api/sensor-history');
            if (history && history.moisture && history.temperature && history.timestamps) {
                // Update timestamp of last history update
                await this.setStateAsync('history.lastSensorUpdate', Date.now(), true);
                
                this.log.info(`Sensor history retrieved: ${history.timestamps.length} data points`);
                
                // Log some statistics for debugging
                if (history.timestamps.length > 0) {
                    const latestTime = new Date(history.timestamps[history.timestamps.length - 1] * 1000);
                    const oldestTime = new Date(history.timestamps[0] * 1000);
                    this.log.info(`Sensor data from ${oldestTime.toLocaleString()} to ${latestTime.toLocaleString()}`);
                }
            }
        } catch (error) {
            this.log.error(`Failed to get sensor history: ${error.message}`);
        }
    }

    /**
     * Get irrigation history
     */
    async getIrrigationHistory() {
        try {
            const events = await this.apiRequest('/api/irrigation-events');
            if (events && events.events) {
                // Find most recent event
                if (events.events.length > 0) {
                    const latestEvent = events.events[events.events.length - 1];
                    const eventTime = new Date(latestEvent.timestamp * 1000);
                    const eventType = latestEvent.event_type === 0 ? 'Started' : 'Stopped';
                    const irrigationType = ['Scheduled', 'Manual', 'Quick'][latestEvent.irrigation_type] || 'Unknown';
                    
                    const eventDescription = `${eventTime.toLocaleString()}: ${irrigationType} irrigation channel ${latestEvent.channel} ${eventType}`;
                    await this.setStateAsync('history.lastIrrigationEvent', eventDescription, true);
                }
                
                this.log.info(`Irrigation history retrieved: ${events.events.length} events`);
            }
        } catch (error) {
            this.log.error(`Failed to get irrigation history: ${error.message}`);
        }
    }

    /**
     * Save configuration to ESP32
     */
    async saveConfiguration() {
        try {
            this.log.info('Saving configuration to ESP32...');
            
            // Collect current configuration from states
            const config = {};
            
            // Get basic config
            const moistureThreshold = await this.getStateAsync('config.moistureThreshold');
            const dstEnabled = await this.getStateAsync('config.dstEnabled');
            
            config.moistureThreshold = moistureThreshold ? moistureThreshold.val : 30;
            config.dstEnabled = dstEnabled ? dstEnabled.val : true;
            
            // Get schedule
            config.schedule = [];
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            
            for (let i = 0; i < 7; i++) {
                const day = days[i];
                
                const enabled = await this.getStateAsync(`schedule.${day}.enabled`);
                const hour = await this.getStateAsync(`schedule.${day}.hour`);
                const minute = await this.getStateAsync(`schedule.${day}.minute`);
                const duration1 = await this.getStateAsync(`schedule.${day}.duration1`);
                const duration2 = await this.getStateAsync(`schedule.${day}.duration2`);
                
                config.schedule.push({
                    enabled: enabled ? enabled.val : false,
                    hour: hour ? hour.val : 6,
                    minute: minute ? minute.val : 0,
                    duration1: duration1 ? duration1.val : 10,
                    duration2: duration2 ? duration2.val : 10
                });
            }
            
            // Send configuration
            const result = await this.apiRequest('/api/config', 'POST', config);
            
            if (result && result.success) {
                this.log.info('Configuration saved successfully');
                
                // Update all states to reflect saved config
                setTimeout(async () => {
                    await this.updateConfig();
                }, 1000);
            }
        } catch (error) {
            this.log.error(`Failed to save configuration: ${error.message}`);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Esp32Irrigation(options);
} else {
    // otherwise start the instance directly
    new Esp32Irrigation();
}