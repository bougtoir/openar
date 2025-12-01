const { ipcRenderer } = require('electron');

const VITALDB_MODES = {
    VITALRECORDER: 'vitalrecorder'
};

class AnesthesiaRecordApp {
    constructor() {
        this.drugs = [];
        this.ivFluids = [];
        this.remarks = [];
        this.vitalSigns = [];
        this.drugConfig = [];
        this.remarksConfig = [];
        this.ivFluidConfig = [];
        this.vitalSignConfig = [];
        this.chart = null;
        this.startTime = new Date();
        this.drugRows = [];
        this.fluidRows = [];
        
        this.vitalDBConfig = {
            baseURL: 'https://vitaldb.net/api',
            accessToken: null,
            vrcode: null,
            username: null,
            password: null
        };
        this.isVitalDBConnected = false;
        this.vitalDBMode = false;
        this.currentVitalDBMode = VITALDB_MODES.VITALRECORDER;
        
        this.vitalRecorderConfig = {
            serviceURL: 'http://127.0.0.1:5002',
            dataDelaySeconds: 1,
            samplingRateHz: 10,
            monitoringActive: false,
            availableParameters: [],
            selectedParameters: {},
            parameterMappings: {}
        };
        this.isVitalRecorderConnected = false;
        
        this.init();
    }

    async init() {
        await this.loadConfigurations();
        await this.loadSettings();
        this.setupEventListeners();
        this.initializeChart();
        this.updateTimeInputs();
        this.renderDrugRows();
        this.renderFluidRows();
        this.renderVitalParameters();
        this.updateTimelines();
        
        setInterval(() => {
            this.updateChart();
        }, 2000);
    }

    async loadConfigurations() {
        this.drugConfig = await ipcRenderer.invoke('load-config', 'drugs') || this.getDefaultDrugs();
        this.remarksConfig = await ipcRenderer.invoke('load-config', 'remarks') || this.getDefaultRemarks();
        this.ivFluidConfig = await ipcRenderer.invoke('load-config', 'ivfluids') || this.getDefaultIVFluids();
        this.vitalSignConfig = await ipcRenderer.invoke('load-config', 'vitalsigns') || this.getDefaultVitalSigns();

        if (!this.drugConfig.length) {
            this.drugConfig = this.getDefaultDrugs();
            await ipcRenderer.invoke('save-config', 'drugs', this.drugConfig);
        }
        if (!this.remarksConfig.length) {
            this.remarksConfig = this.getDefaultRemarks();
            await ipcRenderer.invoke('save-config', 'remarks', this.remarksConfig);
        }
        if (!this.ivFluidConfig.length) {
            this.ivFluidConfig = this.getDefaultIVFluids();
            await ipcRenderer.invoke('save-config', 'ivfluids', this.ivFluidConfig);
        }
        if (!this.vitalSignConfig.length) {
            this.vitalSignConfig = this.getDefaultVitalSigns();
            await ipcRenderer.invoke('save-config', 'vitalsigns', this.vitalSignConfig);
        }

        this.populateSelects();
        this.setupFluidSelectHandler();
    }

    async loadSettings() {
        try {
            const settings = await ipcRenderer.invoke('load-settings');
            if (settings) {
                Object.keys(settings.collapsibleStates || {}).forEach(sectionName => {
                    const content = document.getElementById(`${sectionName}-content`);
                    const icon = content?.parentElement.querySelector('.collapse-icon');
                    if (content && icon) {
                        if (settings.collapsibleStates[sectionName]) {
                            content.classList.add('expanded');
                            icon.classList.add('expanded');
                            icon.textContent = '-';
                        } else {
                            content.classList.remove('expanded');
                            content.classList.add('collapsed');
                            icon.classList.remove('expanded');
                            icon.classList.add('collapsed');
                            icon.textContent = '+';
                        }
                    }
                });
                
                if (settings.timeFrame) document.getElementById('timeFrame').value = settings.timeFrame;
                if (settings.drugDisplayCount) document.getElementById('drugDisplayCount').value = settings.drugDisplayCount;
                if (settings.vitalUpdateInterval) document.getElementById('vitalUpdateInterval').value = settings.vitalUpdateInterval;
                if (settings.dataSource) {
                    document.getElementById('dataSource').value = settings.dataSource;
                    this.currentVitalDBMode = settings.dataSource;
                    
                    const vitaldbSettings = document.getElementById('vitaldbSettings');
                    if (settings.dataSource === VITALDB_MODES.DEMO || settings.dataSource === VITALDB_MODES.REAL) {
                        vitaldbSettings.style.display = 'block';
                        this.vitalDBMode = true;
                    } else {
                        vitaldbSettings.style.display = 'none';
                        this.vitalDBMode = false;
                    }
                }
                
                if (settings.vitaldbUsername) document.getElementById('vitaldbUsername').value = settings.vitaldbUsername;
                if (settings.vitaldbVrcode) document.getElementById('vitaldbVrcode').value = settings.vitaldbVrcode;
                if (settings.vitalrecorderDirectory) {
                    document.getElementById('vitalrecorderDirectory').value = settings.vitalrecorderDirectory;
                    this.vitalRecorderConfig.vitaldbDirectory = settings.vitalrecorderDirectory;
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async saveSettings() {
        try {
            const settings = {
                collapsibleStates: {},
                timeFrame: document.getElementById('timeFrame').value,
                drugDisplayCount: document.getElementById('drugDisplayCount').value,
                vitalUpdateInterval: document.getElementById('vitalUpdateInterval').value,
                dataSource: document.getElementById('dataSource').value,
                vitaldbUsername: document.getElementById('vitaldbUsername').value,
                vitaldbVrcode: document.getElementById('vitaldbVrcode').value,
                vitalrecorderDirectory: document.getElementById('vitalrecorderDirectory').value
            };
            
            ['remarks', 'drugs', 'fluids', 'settings', 'vitals', 'remarks-display', 'drugs-display', 'fluids-display'].forEach(sectionName => {
                const content = document.getElementById(`${sectionName}-content`);
                if (content) {
                    settings.collapsibleStates[sectionName] = content.classList.contains('expanded');
                }
            });
            
            await ipcRenderer.invoke('save-settings', settings);
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    getDefaultDrugs() {
        return [
            { name: "酸素", unit: "L/min", continuous: false, color: "#0066CC", defaultDose: 2 },
            { name: "セボフレン", unit: "%", continuous: true, color: "#FF6600", defaultDose: 1.5 },
            { name: "ミダゾラム", unit: "mg", continuous: false, color: "#9900CC", defaultDose: 2 },
            { name: "デクスメデトミジン", unit: "mg/kg/hr", continuous: true, color: "#CC0066", defaultDose: 0.5 },
            { name: "ロピバカイン", unit: "ml/hr", continuous: true, color: "#00CC66", defaultDose: 10 },
            { name: "等比重マーカイン", unit: "ml", continuous: false, color: "#CCCC00", defaultDose: 3 }
        ];
    }

    getDefaultRemarks() {
        return [
            { name: "麻酔開始", icon: "×", color: "#FF0000" },
            { name: "麻酔終了", icon: "×", color: "#FF0000" },
            { name: "手術開始", icon: "◎", color: "#0066FF" },
            { name: "手術終了", icon: "◎", color: "#0066FF" },
            { name: "手術室開始", icon: "◆", color: "#00CC00" },
            { name: "手術室終了", icon: "◆", color: "#00CC00" },
            { name: "気道管理開始", icon: "T", color: "#FF6600" },
            { name: "気道管理終了", icon: "T", color: "#FF6600" }
        ];
    }

    getDefaultIVFluids() {
        return [
            { name: "生理食塩水", initialVolume: 500 },
            { name: "リンゲル液", initialVolume: 500 },
            { name: "5%ブドウ糖液", initialVolume: 500 }
        ];
    }

    getDefaultVitalSigns() {
        return [
            { name: "心拍数", symbol: "♥", color: "#FF0000", range: "40-150", decimals: 0, interval: 5, continuous: true },
            { name: "酸素飽和度", symbol: "○", color: "#0066FF", range: "80-100", decimals: 0, interval: 2, continuous: true },
            { name: "収縮期血圧", symbol: "▼", color: "#FF6600", range: "60-220", decimals: 0, interval: 10, continuous: true },
            { name: "拡張期血圧", symbol: "▲", color: "#FF6600", range: "40-120", decimals: 0, interval: 10, continuous: true },
            { name: "体温", symbol: "℃", color: "#00CC00", range: "35-40", decimals: 1, interval: 0.5, continuous: true },
            { name: "呼気二酸化炭素", symbol: "CO₂", color: "#CCCC00", range: "20-60", decimals: 0, interval: 5, continuous: false },
            { name: "呼気麻酔ガス濃度", symbol: "Gas", color: "#CC00CC", range: "0-8", decimals: 0, interval: 1, continuous: false }
        ];
    }

    populateSelects() {
        const drugSelect = document.getElementById('drugSelect');
        const remarksSelect = document.getElementById('remarksSelect');
        const fluidSelect = document.getElementById('fluidSelect');

        drugSelect.innerHTML = '<option value="">薬剤を選択</option>';
        this.drugConfig.forEach((drug, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${drug.name}(${drug.unit})`;
            drugSelect.appendChild(option);
        });

        remarksSelect.innerHTML = '<option value="">リマークスを選択</option>';
        this.remarksConfig.forEach((remark, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = remark.name;
            remarksSelect.appendChild(option);
        });

        fluidSelect.innerHTML = '<option value="">輸液を選択</option>';
        this.ivFluidConfig.forEach((fluid, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = fluid.name;
            fluidSelect.appendChild(option);
        });
    }

    setupEventListeners() {
        document.getElementById('addRemarks').addEventListener('click', () => this.addRemark());
        document.getElementById('addDrug').addEventListener('click', () => this.addDrug());
        document.getElementById('addFluid').addEventListener('click', () => this.addFluid());
        
        document.getElementById('fluidSelect').addEventListener('change', (e) => {
            const volumeInput = document.getElementById('fluidVolume');
            if (e.target.value !== '') {
                const fluidConfig = this.ivFluidConfig[parseInt(e.target.value)];
                if (fluidConfig && fluidConfig.initialVolume) {
                    volumeInput.value = fluidConfig.initialVolume;
                }
            } else {
                volumeInput.value = '';
            }
        });
        
        document.getElementById('anesthesiaStart').addEventListener('click', () => this.addQuickRemark('麻酔開始'));
        document.getElementById('anesthesiaEnd').addEventListener('click', () => this.addQuickRemark('麻酔終了'));
        document.getElementById('surgeryStart').addEventListener('click', () => this.addQuickRemark('手術開始'));
        document.getElementById('surgeryEnd').addEventListener('click', () => this.addQuickRemark('手術終了'));
        document.getElementById('roomStart').addEventListener('click', () => this.addQuickRemark('手術室開始'));
        document.getElementById('roomEnd').addEventListener('click', () => this.addQuickRemark('手術室終了'));

        document.getElementById('timeFrame').addEventListener('change', () => {
            this.updateChartTimeAxis();
            this.updateTimelines();
            this.updateChartEventIcons();
            this.saveSettings();
        });
        document.getElementById('drugDisplayCount').addEventListener('change', () => {
            this.renderDrugRows();
            this.updateChart();
            this.saveSettings();
        });
        
        document.getElementById('drugSelect').addEventListener('change', (e) => {
            if (e.target.value !== '') {
                const drugConfig = this.drugConfig[parseInt(e.target.value)];
                document.getElementById('drugDose').value = drugConfig.defaultDose || '';
            }
        });
        
        const acquisitionToggle = document.getElementById('acquisitionToggle');
        const toggleLabel = document.querySelector('.toggle-label');
        acquisitionToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startVitalSignAcquisition();
                toggleLabel.textContent = '取得停止';
            } else {
                this.stopVitalSignAcquisition();
                toggleLabel.textContent = '取得開始';
            }
        });
        
        document.getElementById('vitalUpdateInterval').addEventListener('change', () => {
            if (this.isAcquiring) {
                this.stopVitalSignAcquisition();
                this.startVitalSignAcquisition();
            }
            this.saveSettings();
        });

        const vitaldbSettings = document.getElementById('vitaldbSettings');
        const vitalrecorderSettings = document.getElementById('vitalrecorderSettings');
        vitaldbSettings.style.display = 'none';
        vitalrecorderSettings.style.display = 'block';
        this.vitalDBMode = false;

        document.getElementById('connectVitalDB').addEventListener('click', async () => {
            const username = document.getElementById('vitaldbUsername').value;
            const password = document.getElementById('vitaldbPassword').value;
            const vrcode = document.getElementById('vitaldbVrcode').value;
            
            if (!username || !password || !vrcode) {
                this.updateVitalDBStatus('認証情報を入力してください', 'error');
                return;
            }

            if (vrcode.length !== 9 || !/^\d{9}$/.test(vrcode)) {
                this.updateVitalDBStatus('VRコードは9桁の数字で入力してください', 'error');
                return;
            }

            this.updateVitalDBStatus('接続中...', 'connecting');
            
            const success = await this.authenticateVitalDB(username, password);
            if (success) {
                this.vitalDBConfig.vrcode = vrcode;
                this.updateVitalDBStatus('接続成功', 'success');
            } else {
                this.updateVitalDBStatus('接続失敗', 'error');
            }
        });

        document.getElementById('vitaldbUsername').addEventListener('change', () => this.saveSettings());
        document.getElementById('vitaldbVrcode').addEventListener('change', () => this.saveSettings());

        this.connectVitalRecorder();


        document.getElementById('vitalrecorderDelay').addEventListener('change', (e) => {
            this.vitalRecorderConfig.dataDelaySeconds = parseInt(e.target.value);
            this.updateVitalRecorderConfig();
            this.saveSettings();
        });

        document.getElementById('vitalrecorderSamplingRate').addEventListener('change', (e) => {
            this.vitalRecorderConfig.samplingRateHz = parseFloat(e.target.value);
            this.updateVitalRecorderConfig();
            this.saveSettings();
        });

        document.getElementById('updateVitalrecorderDirectory').addEventListener('click', async () => {
            const directoryInput = document.getElementById('vitalrecorderDirectory');
            const directory = directoryInput.value.trim();
            if (directory) {
                await this.updateVitalRecorderDirectory(directory);
                this.saveSettings();
            }
        });

        document.getElementById('vitalrecorderDirectory').addEventListener('change', () => {
            this.saveSettings();
        });

        const refreshTimeseriesBtn = document.getElementById('refreshTimeseriesBtn');
        if (refreshTimeseriesBtn) {
            refreshTimeseriesBtn.addEventListener('click', () => this.refreshTimeseriesData());
        }
        
        const timeseriesRange = document.getElementById('timeseriesRange');
        if (timeseriesRange) {
            timeseriesRange.addEventListener('change', () => this.renderTimeseriesData());
        }

    }

    toggleSection(sectionName) {
        const content = document.getElementById(`${sectionName}-content`);
        const icon = content.parentElement.querySelector('.collapse-icon');
        
        if (content.classList.contains('expanded')) {
            content.classList.remove('expanded');
            content.classList.add('collapsed');
            icon.classList.remove('expanded');
            icon.classList.add('collapsed');
            icon.textContent = '+';
        } else {
            content.classList.add('expanded');
            content.classList.remove('collapsed');
            icon.classList.add('expanded');
            icon.classList.remove('collapsed');
            icon.textContent = '-';
        }
        
        this.saveSettings();
    }

    toggleChartSection() {
        return;
    }

    updateTimeInputs() {
        const now = new Date();
        const timeString = now.toTimeString().slice(0, 5);
        
        const timeInputs = document.querySelectorAll('input[type="time"]');
        timeInputs.forEach(input => {
            if (!input.value) {
                input.value = timeString;
            }
            if (input.placeholder === '現在時刻' || input.placeholder === '--:--') {
                input.placeholder = timeString;
            }
        });
    }

    addRemark() {
        const select = document.getElementById('remarksSelect');
        const custom = document.getElementById('remarksCustom');
        const memo = document.getElementById('remarksMemo');
        const time = document.getElementById('remarksTime');

        let remarkText = '';
        let icon = '●';

        if (select.value !== '') {
            const remarkConfig = this.remarksConfig[parseInt(select.value)];
            remarkText = remarkConfig.name;
            icon = remarkConfig.icon;
        } else if (custom.value.trim() !== '') {
            remarkText = custom.value.trim();
        } else {
            return;
        }

        const remarkTime = time.value ? this.parseTime(time.value) : new Date();
        const remarkMemo = memo ? memo.value.trim() : '';
        
        this.remarks.push({
            text: remarkText,
            memo: remarkMemo,
            icon: icon,
            time: remarkTime,
            startTime: this.startTime
        });

        if (this.isTrackingEvent(remarkText)) {
            this.startElapsedTimer(remarkText, remarkTime);
        } else if (remarkText.includes('麻酔終了') || remarkText.includes('手術終了')) {
            const startEventType = remarkText.includes('麻酔終了') ? '麻酔開始' : '手術開始';
            this.stopElapsedTimer(startEventType);
        }

        this.updateTimelines();
        custom.value = '';
        select.value = '';
        if (memo) memo.value = '';
    }

    addQuickRemark(remarkName) {
        const remarkConfig = this.remarksConfig.find(r => r.name === remarkName);
        if (remarkConfig) {
            this.remarks.push({
                text: remarkConfig.name,
                icon: remarkConfig.icon,
                time: new Date(),
                startTime: this.startTime
            });

            if (this.isTrackingEvent(remarkConfig.name)) {
                this.startElapsedTimer(remarkConfig.name, new Date());
            } else if (remarkConfig.name.includes('麻酔終了') || remarkConfig.name.includes('手術終了')) {
                const startEventType = remarkConfig.name.includes('麻酔終了') ? '麻酔開始' : '手術開始';
                this.stopElapsedTimer(startEventType);
            }

            this.updateTimelines();
        }
    }

    addDrug() {
        const select = document.getElementById('drugSelect');
        const dose = document.getElementById('drugDose');
        const time = document.getElementById('drugTime');

        if (select.value === '' || dose.value === '') return;

        const drugConfig = this.drugConfig[parseInt(select.value)];
        const drugTime = time.value ? this.parseTime(time.value) : new Date();
        const doseValue = parseFloat(dose.value);

        if (doseValue === 0 && drugConfig.continuous) {
            const existingDrug = this.drugs.filter(d => d.name === drugConfig.name && d.continuous && !d.endTime).pop();
            if (existingDrug) {
                existingDrug.endTime = drugTime;
            }
        } else {
            this.drugs.push({
                name: drugConfig.name,
                unit: drugConfig.unit,
                dose: doseValue,
                color: drugConfig.color,
                continuous: drugConfig.continuous,
                time: drugTime
            });
        }

        this.updateTimelines();
        dose.value = '';
        select.value = '';
        time.value = '';
    }

    addFluid() {
        const select = document.getElementById('fluidSelect');
        const volume = document.getElementById('fluidVolume');
        const time = document.getElementById('fluidTime');

        if (select.value === '' || volume.value === '') return;

        const fluidConfig = this.ivFluidConfig[parseInt(select.value)];
        const fluidTime = time.value ? this.parseTime(time.value) : new Date();
        const volumeValue = parseInt(volume.value);

        if (volumeValue === 0) {
            const existingFluid = this.ivFluids.filter(f => f.name === fluidConfig.name && f.continuous && !f.endTime).pop();
            if (existingFluid) {
                existingFluid.endTime = fluidTime;
            }
        } else {
            this.ivFluids.push({
                name: fluidConfig.name,
                initialVolume: volumeValue,
                startTime: fluidTime,
                continuous: true,
                endTime: null,
                endVolume: null
            });
        }

        this.updateTimelines();
        volume.value = '';
        select.value = '';
        time.value = '';
    }

    renderDrugRows() {
        const container = document.getElementById('drugRows');
        const displayCount = parseInt(document.getElementById('drugDisplayCount').value);
        
        container.innerHTML = '';
        
        for (let i = 0; i < displayCount; i++) {
            const row = document.createElement('div');
            row.className = 'drug-row';
            row.innerHTML = `<span>薬剤${i + 1}</span><span>未設定</span>`;
            container.appendChild(row);
        }
    }

    renderFluidRows() {
        const container = document.getElementById('fluidRows');
        container.innerHTML = '';
        
        for (let i = 0; i < 5; i++) {
            const row = document.createElement('div');
            row.className = 'fluid-row';
            row.innerHTML = `<span>輸液${i + 1}</span><span>未設定</span>`;
            container.appendChild(row);
        }
    }

    renderVitalParameters() {
        const container = document.getElementById('vitalParameters');
        container.innerHTML = '';

        this.vitalSignConfig.forEach((vital, index) => {
            const param = document.createElement('div');
            param.className = 'vital-param';
            param.innerHTML = `
                <label>
                    <input type="checkbox" checked data-index="${index}">
                    ${vital.symbol} ${vital.name} (${vital.range})
                </label>
            `;
            container.appendChild(param);
        });

        this.updateCurrentVitalValues();
    }

    updateCurrentVitalValues(vitalRecorderData = null) {
        console.log('updateCurrentVitalValues called with data:', vitalRecorderData);
        console.log('isVitalRecorderConnected:', this.isVitalRecorderConnected);
        
        const container = document.getElementById('currentVitalValues');
        if (container) container.innerHTML = '';

        const sections = [
            { main: 'HR', sub: null, className: 'vital-section-hr' },
            { main: 'SpO2', sub: 'BT', className: 'vital-section-spo2' },
            { main: 'sNIBP', sub: null, className: 'vital-section-bp' },
            { main: 'EtCO2', sub: 'EtGas', className: 'vital-section-etco2' }
        ];
        
        sections.forEach(section => {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = `vital-section ${section.className}`;
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'vital-param-label';
            const paramNames = {
                'HR': 'HR',
                'SpO2': 'SpO2',
                'sNIBP': 'BP',
                'EtCO2': 'EtCO2'
            };
            labelDiv.textContent = paramNames[section.main] || section.main;
            sectionDiv.appendChild(labelDiv);
            
            let mainValue = null;
            if (section.main === 'sNIBP') {
                const sysValue = this.getCurrentVitalValue('sNIBP', vitalRecorderData);
                const diaValue = this.getCurrentVitalValue('dNIBP', vitalRecorderData);
                if (sysValue !== '--' && diaValue !== '--') {
                    mainValue = `${sysValue}/${diaValue}`;
                } else {
                    mainValue = '--/--';
                }
            } else {
                mainValue = this.getCurrentVitalValue(section.main, vitalRecorderData);
            }
            
            if (mainValue && mainValue !== '--' && mainValue !== '--/--') {
                const mainDiv = document.createElement('div');
                mainDiv.className = 'vital-main-value';
                mainDiv.textContent = mainValue;
                const mainVital = this.vitalSignConfig.find(v => v.name === section.main);
                if (mainVital) {
                    mainDiv.style.color = mainVital.color;
                }
                sectionDiv.appendChild(mainDiv);
                
                if (section.sub) {
                    const subValue = this.getCurrentVitalValue(section.sub, vitalRecorderData);
                    if (subValue && subValue !== '--') {
                        const subContainer = document.createElement('div');
                        subContainer.className = 'vital-sub-container';
                        
                        const subLabelDiv = document.createElement('div');
                        subLabelDiv.className = 'vital-sub-param-label';
                        const subParamNames = {
                            'BT': 'BT',
                            'EtGas': 'EtGas'
                        };
                        subLabelDiv.textContent = subParamNames[section.sub] || section.sub;
                        subContainer.appendChild(subLabelDiv);
                        
                        const subDiv = document.createElement('div');
                        subDiv.className = 'vital-sub-value-with-label';
                        subDiv.textContent = subValue;
                        subDiv.style.color = this.vitalSignConfig.find(v => v.name === section.sub)?.color || '#ffffff';
                        subContainer.appendChild(subDiv);
                        
                        sectionDiv.appendChild(subContainer);
                    }
                }
                
                container.appendChild(sectionDiv);
            }
        });
    }

    updateTimelines() {
        this.updateDrugTimeline();
        this.updateFluidTimeline();
        this.updateRemarksTimeline();
        this.updateCostDisplay();
    }

    updateDrugTimeline() {
        const container = document.getElementById('drugTimeline');
        container.innerHTML = '';

        if (!this.chart) return;

        const timeFrame = parseInt(document.getElementById('timeFrame').value);
        const chartContainer = document.querySelector('.chart-container');
        const chartStartTime = this.chartStartTime || this.acquisitionStartTime || this.getRoomStartTime();
        
        const containerWidth = chartContainer ? chartContainer.offsetWidth : 800;
        let chartPadding = containerWidth * 0.1;
        
        if (this.chart && this.chart.chartArea) {
            chartPadding = this.chart.chartArea.left;
        }
        
        const timelineWidth = containerWidth - chartPadding - 10;

        this.drugConfig.forEach((drugConfig, index) => {
            const row = document.createElement('div');
            row.className = 'timeline-row';
            
            const label = document.createElement('div');
            label.className = 'timeline-label';
            label.textContent = `${drugConfig.name}(${drugConfig.unit})`;
            label.style.color = drugConfig.color || '#000';
            
            const content = document.createElement('div');
            content.className = 'timeline-content';

            const drugEntries = this.drugs.filter(d => d.name === drugConfig.name);
            drugEntries.forEach(drug => {
                const minutesSinceChartStart = (drug.time - chartStartTime) / (1000 * 60);
                
                if (minutesSinceChartStart >= 0 && minutesSinceChartStart <= timeFrame * 60) {
                    const xPixel = this.chart.scales.x.getPixelForValue(minutesSinceChartStart);
                    const chartArea = this.chart.chartArea;
                    
                    const containerRect = chartContainer.getBoundingClientRect();
                    const canvasRect = this.chart.canvas.getBoundingClientRect();
                    const offsetX = canvasRect.left - containerRect.left;
                    
                    const position = xPixel - 10;

                    if (position >= 0) {
                        const marker = document.createElement('div');
                        marker.className = 'timeline-marker';
                        marker.style.left = `${position}px`;
                        marker.style.cursor = 'pointer';
                        marker.textContent = drug.dose;
                        marker.addEventListener('dblclick', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            this.openEditModal('drug', drug);
                        });
                        content.appendChild(marker);

                        if (drug.continuous) {
                            const endTime = drug.endTime || new Date();
                            const endMinutesSinceChartStart = (endTime - chartStartTime) / (1000 * 60);
                            
                            if (endMinutesSinceChartStart <= timeFrame * 60) {
                                const endXPixel = this.chart.scales.x.getPixelForValue(endMinutesSinceChartStart);
                                const endPosition = endXPixel - 10;
                                const lineWidth = Math.max(0, endPosition - position);
                                
                                if (lineWidth > 0) {
                                    const line = document.createElement('div');
                                    line.className = 'timeline-line';
                                    line.style.left = `${position}px`;
                                    line.style.width = `${lineWidth}px`;
                                    line.style.backgroundColor = drug.color || drugConfig.color || '#000';
                                    content.appendChild(line);
                                }
                                
                                if (drug.endTime && endPosition >= 0) {
                                    const endMarker = document.createElement('div');
                                    endMarker.className = 'timeline-marker';
                                    endMarker.style.left = `${endPosition}px`;
                                    endMarker.textContent = '/';
                                    content.appendChild(endMarker);
                                }
                            }
                        }
                    }
                }
            });

            row.appendChild(label);
            row.appendChild(content);
            
            row.addEventListener('dblclick', (e) => {
                if (e.target === row || e.target === label || e.target.classList.contains('timeline-content')) {
                    this.openDrugInputModal(drugConfig.name);
                }
            });
            
            container.appendChild(row);
        });
    }

    updateFluidTimeline() {
        const container = document.getElementById('fluidTimeline');
        container.innerHTML = '';

        if (!this.chart) return;

        const timeFrame = parseInt(document.getElementById('timeFrame').value);
        const chartContainer = document.querySelector('.chart-container');
        const chartStartTime = this.chartStartTime || this.acquisitionStartTime || this.getRoomStartTime();
        
        const containerWidth = chartContainer ? chartContainer.offsetWidth : 800;
        let chartPadding = containerWidth * 0.1;
        
        if (this.chart && this.chart.chartArea) {
            chartPadding = this.chart.chartArea.left;
        }
        
        const timelineWidth = containerWidth - chartPadding - 10;

        const fluidNames = [...new Set(this.ivFluids.map(f => f.name))];
        const maxRows = Math.max(fluidNames.length, 5);

        for (let i = 0; i < maxRows; i++) {
            const row = document.createElement('div');
            row.className = 'timeline-row';
            
            const label = document.createElement('div');
            label.className = 'timeline-label';
            
            if (i < fluidNames.length) {
                const fluidName = fluidNames[i];
                label.textContent = fluidName;
                label.style.color = '#0066FF';
            } else {
                label.textContent = `輸液${i + 1}`;
                label.style.color = '#666';
            }
            
            const content = document.createElement('div');
            content.className = 'timeline-content';

            if (i < fluidNames.length) {
                const fluidName = fluidNames[i];
                const fluidEntries = this.ivFluids.filter(f => f.name === fluidName);

                fluidEntries.forEach(fluid => {
                    const minutesSinceChartStart = (fluid.startTime - chartStartTime) / (1000 * 60);
                    
                    if (minutesSinceChartStart >= 0 && minutesSinceChartStart <= timeFrame * 60) {
                        const xPixel = this.chart.scales.x.getPixelForValue(minutesSinceChartStart);
                        const chartArea = this.chart.chartArea;
                        
                        const containerRect = chartContainer.getBoundingClientRect();
                        const canvasRect = this.chart.canvas.getBoundingClientRect();
                        const offsetX = canvasRect.left - containerRect.left;
                        
                        const position = xPixel - 10;

                        if (position >= 0) {
                            const marker = document.createElement('div');
                            marker.className = 'timeline-marker';
                            marker.style.left = `${position}px`;
                            marker.style.cursor = 'pointer';
                            marker.textContent = `${fluid.initialVolume}`;
                            marker.addEventListener('dblclick', (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                this.openEditModal('fluid', fluid);
                            });
                            content.appendChild(marker);

                            if (fluid.continuous) {
                                const endTime = fluid.endTime || new Date();
                                const endMinutesSinceChartStart = (endTime - chartStartTime) / (1000 * 60);
                                
                                if (endMinutesSinceChartStart <= timeFrame * 60) {
                                    const endXPixel = this.chart.scales.x.getPixelForValue(endMinutesSinceChartStart);
                                    const endPosition = endXPixel - 10;
                                    const lineWidth = Math.max(0, endPosition - position);
                                    
                                    if (lineWidth > 0) {
                                        const line = document.createElement('div');
                                        line.className = 'timeline-line';
                                        line.style.left = `${position}px`;
                                        line.style.width = `${lineWidth}px`;
                                        line.style.backgroundColor = '#0066FF';
                                        content.appendChild(line);
                                    }
                                }
                            }
                            
                            if (fluid.endTime) {
                                const endMinutesSinceChartStart = (fluid.endTime - chartStartTime) / (1000 * 60);
                                
                                if (endMinutesSinceChartStart <= timeFrame * 60) {
                                    const endXPixel = this.chart.scales.x.getPixelForValue(endMinutesSinceChartStart);
                                    const endPosition = endXPixel - 10;
                                    
                                    if (endPosition >= 0) {
                                        const endMarker = document.createElement('div');
                                        endMarker.className = 'timeline-marker';
                                        endMarker.style.left = `${endPosition}px`;
                                        endMarker.textContent = '/';
                                        content.appendChild(endMarker);
                                    }
                                }
                            }
                        }
                    }
                });

                row.addEventListener('dblclick', (e) => {
                    if (e.target === row || e.target === label || e.target.classList.contains('timeline-content')) {
                        const fluidEntries = this.ivFluids.filter(f => f.name === fluidName)
                            .sort((a, b) => a.startTime - b.startTime);
                        
                        const lastEntry = fluidEntries[fluidEntries.length - 1];
                        const previousWasEnd = lastEntry && lastEntry.endTime;
                        
                        const mockItem = {
                            name: fluidName,
                            initialVolume: '',
                            startTime: new Date(),
                            previousWasEnd: previousWasEnd
                        };
                        
                        this.openEditModal('fluid', mockItem);
                    }
                });
            }

            row.appendChild(label);
            row.appendChild(content);
            container.appendChild(row);
        }
    }

    updateRemarksTimeline() {
        const container = document.getElementById('eventList');
        if (!container) return;
        
        container.innerHTML = '';

        this.remarks.forEach(remark => {
            const item = document.createElement('div');
            item.className = 'event-item';
            item.style.cursor = 'pointer';
            
            const timeDiv = document.createElement('div');
            timeDiv.className = 'event-time';
            timeDiv.textContent = remark.time.toLocaleTimeString('ja-JP', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            const textDiv = document.createElement('div');
            textDiv.className = 'event-text';
            textDiv.textContent = remark.text;
            
            const elapsedDiv = document.createElement('div');
            elapsedDiv.className = 'event-elapsed';
            if (this.isTrackingEvent(remark.text)) {
                elapsedDiv.textContent = this.getElapsedTime(remark.text, remark.time);
            }
            
            item.appendChild(timeDiv);
            item.appendChild(textDiv);
            item.appendChild(elapsedDiv);
            
            item.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openEditModal('remark', remark);
            });
            
            container.appendChild(item);
        });
        
        this.updateChartEventIcons();
    }

    updateCostDisplay() {
        const container = document.getElementById('costBreakdown');
        const totalElement = document.getElementById('totalCostValue');
        if (!container || !totalElement) return;

        const costs = this.calculateTotalCosts();
        
        totalElement.textContent = costs.total.toLocaleString('ja-JP');
        
        container.innerHTML = '';

        if (costs.drugs.length > 0) {
            const drugCategory = document.createElement('div');
            drugCategory.className = 'cost-category';
            drugCategory.innerHTML = '<div class="cost-category-header">薬剤</div>';
            
            costs.drugs.forEach(item => {
                const costItem = document.createElement('div');
                costItem.className = 'cost-item';
                costItem.innerHTML = `
                    <div class="cost-item-info">
                        <div class="cost-item-name">${item.name}</div>
                        <div class="cost-item-details">${item.details}</div>
                    </div>
                    <div class="cost-item-time">${item.time.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div class="cost-item-amount">¥${item.cost.toLocaleString('ja-JP')}</div>
                `;
                drugCategory.appendChild(costItem);
            });
            container.appendChild(drugCategory);
        }

        if (costs.fluids.length > 0) {
            const fluidCategory = document.createElement('div');
            fluidCategory.className = 'cost-category';
            fluidCategory.innerHTML = '<div class="cost-category-header">輸液</div>';
            
            costs.fluids.forEach(item => {
                const costItem = document.createElement('div');
                costItem.className = 'cost-item';
                costItem.innerHTML = `
                    <div class="cost-item-info">
                        <div class="cost-item-name">${item.name}</div>
                        <div class="cost-item-details">${item.details}</div>
                    </div>
                    <div class="cost-item-time">${item.time.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div class="cost-item-amount">¥${item.cost.toLocaleString('ja-JP')}</div>
                `;
                fluidCategory.appendChild(costItem);
            });
            container.appendChild(fluidCategory);
        }

        if (costs.remarks.length > 0) {
            const remarkCategory = document.createElement('div');
            remarkCategory.className = 'cost-category';
            remarkCategory.innerHTML = '<div class="cost-category-header">イベント</div>';
            
            costs.remarks.forEach(item => {
                const costItem = document.createElement('div');
                costItem.className = 'cost-item';
                costItem.innerHTML = `
                    <div class="cost-item-info">
                        <div class="cost-item-name">${item.name}</div>
                        <div class="cost-item-details">${item.details}</div>
                    </div>
                    <div class="cost-item-time">${item.time.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div class="cost-item-amount">¥${item.cost.toLocaleString('ja-JP')}</div>
                `;
                remarkCategory.appendChild(costItem);
            });
            container.appendChild(remarkCategory);
        }

        if (costs.total === 0) {
            container.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">コストデータがありません</div>';
        }
    }

    calculateDrugCost(drug, drugConfig) {
        if (!drugConfig.price_per_unit || !drugConfig.cost_unit) return 0;
        
        let totalUsage = 0;
        if (drugConfig.continuous && drug.endTime) {
            const durationMinutes = Math.floor((drug.endTime - drug.time) / (1000 * 60));
            totalUsage = drug.dose * durationMinutes;
        } else if (!drugConfig.continuous) {
            totalUsage = drug.dose;
        } else {
            const durationMinutes = Math.floor((new Date() - drug.time) / (1000 * 60));
            totalUsage = drug.dose * durationMinutes;
        }
        
        const units = Math.ceil(totalUsage / drugConfig.cost_unit);
        return units * drugConfig.price_per_unit;
    }

    calculateFluidCost(fluid, fluidConfig) {
        if (!fluidConfig.price_per_unit || !fluidConfig.unit) return 0;
        
        const units = Math.ceil(fluid.initialVolume / fluidConfig.unit);
        return units * fluidConfig.price_per_unit;
    }

    calculateRemarkCost(remark, remarkConfig) {
        if (!remarkConfig.price_per_unit || !remarkConfig.unit) return 0;
        
        const endEvent = this.remarks.find(r => 
            (remark.text.includes('麻酔開始') && r.text.includes('麻酔終了')) ||
            (remark.text.includes('手術開始') && r.text.includes('手術終了')) ||
            (remark.text.includes('手術室開始') && r.text.includes('手術室終了'))
        );
        
        if (!endEvent) return 0;
        
        const durationMinutes = Math.floor((endEvent.time - remark.time) / (1000 * 60));
        const units = Math.ceil(durationMinutes / remarkConfig.unit);
        return units * remarkConfig.price_per_unit;
    }

    calculateTotalCosts() {
        const costs = {
            drugs: [],
            fluids: [],
            remarks: [],
            total: 0
        };

        this.drugs.forEach(drug => {
            const drugConfig = this.drugConfig.find(d => d.name === drug.name);
            if (drugConfig) {
                const cost = this.calculateDrugCost(drug, drugConfig);
                if (cost > 0) {
                    costs.drugs.push({
                        name: drug.name,
                        time: drug.time,
                        cost: cost,
                        details: drugConfig.continuous ? '持続投与' : '単回投与'
                    });
                    costs.total += cost;
                }
            }
        });

        this.ivFluids.forEach(fluid => {
            const fluidConfig = this.ivFluidConfig.find(f => f.name === fluid.name);
            if (fluidConfig) {
                const cost = this.calculateFluidCost(fluid, fluidConfig);
                if (cost > 0) {
                    costs.fluids.push({
                        name: fluid.name,
                        time: fluid.startTime,
                        cost: cost,
                        details: `${fluid.initialVolume}ml`
                    });
                    costs.total += cost;
                }
            }
        });

        this.remarks.forEach(remark => {
            if (this.isTrackingEvent(remark.text)) {
                const remarkConfig = this.remarksConfig.find(r => r.name === remark.text);
                if (remarkConfig) {
                    const cost = this.calculateRemarkCost(remark, remarkConfig);
                    if (cost > 0) {
                        costs.remarks.push({
                            name: remark.text,
                            time: remark.time,
                            cost: cost,
                            details: 'イベント期間'
                        });
                        costs.total += cost;
                    }
                }
            }
        });

        return costs;
    }

    initializeChart() {
        const ctx = document.getElementById('vitalChart').getContext('2d');
        
        this.chart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: []
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                backgroundColor: '#000000',
                layout: {
                    padding: {
                        left: 0,
                        right: 15,
                        top: 15,
                        bottom: 15
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        min: 0,
                        max: 480,

                        grid: {
                            color: function(context) {
                                const value = context.tick.value;
                                if (value % 60 === 0) return '#dee2e6';
                                if (value % 15 === 0) return '#e9ecef';
                                return 'transparent';
                            },
                            lineWidth: function(context) {
                                const value = context.tick.value;
                                if (value % 60 === 0) return 2;
                                if (value % 15 === 0) return 1;
                                return 1;
                            }
                        },
                        ticks: {
                            stepSize: 15,
                            maxTicksLimit: 33,
                            color: '#ffffff',
                            callback: function(value) {
                                if (value % 60 === 0) {
                                    const chartStartTime = app.chartStartTime || app.acquisitionStartTime || new Date();
                                    const absoluteTime = new Date(chartStartTime.getTime() + value * 60000);
                                    return absoluteTime.getHours().toString().padStart(2, '0');
                                }
                                return '';
                            },
                            maxRotation: 0,
                            minRotation: 0
                        },
                        title: {
                            display: false
                        }
                    },
                    y: {
                        min: 10,
                        max: 90,
                        grid: {
                            color: '#e9ecef'
                        },
                        ticks: {
                            display: false,
                            color: '#ffffff'
                        },
                        title: {
                            display: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                const datasetLabel = context.dataset.label;
                                const vitalName = datasetLabel.split(' ').slice(1).join(' ');
                                
                                const customMapping = Object.values(app.vitalRecorderConfig.parameterMappings).find(mapping => mapping.label === vitalName);
                                let range;
                                if (customMapping && customMapping.range) {
                                    range = customMapping.range;
                                } else if (customMapping && customMapping.rangeMin !== undefined && customMapping.rangeMax !== undefined) {
                                    range = `${customMapping.rangeMin}-${customMapping.rangeMax}`;
                                } else {
                                    const vital = app.vitalSignConfig.find(v => v.name === vitalName);
                                    range = vital ? vital.range : '0-100';
                                }
                                
                                const [min, max] = range.split('-').map(Number);
                                const rawValue = ((context.parsed.y - 10) / 80) * (max - min) + min;
                                const formattedValue = app.formatVitalValue(vitalName, rawValue);
                                return `${vitalName}: ${formattedValue}`;
                            }
                        }
                    }
                }
            }
        });

        this.updateChartLegend();
        this.initializeEmptyVitalData();
        this.updateChartTimeAxis();
        this.renderTimeseriesData();
        this.updateChartRangeLabels();
    }

    updateChartLegend() {
    }

    initializeEmptyVitalData() {
        this.vitalSigns = this.vitalSignConfig.map(vital => ({
            name: vital.name,
            symbol: vital.symbol,
            color: vital.color,
            range: vital.range,
            data: []
        }));
    }

    updateChart() {
        if (!this.chart) return;

        const datasets = this.vitalSigns.map(vital => {
            let range = vital.range;
            const customMapping = Object.values(this.vitalRecorderConfig.parameterMappings).find(mapping => mapping.label === vital.name);
            if (customMapping && customMapping.range) {
                range = customMapping.range;
            } else if (customMapping && customMapping.rangeMin !== undefined && customMapping.rangeMax !== undefined) {
                range = `${customMapping.rangeMin}-${customMapping.rangeMax}`;
            }
            
            const [min, max] = range.split('-').map(Number);
            const normalizedData = vital.data.map(point => ({
                x: point.x,
                y: 10 + ((point.y - min) / (max - min)) * 80
            }));
            
            let showLine = false;
            let borderColor = 'transparent';
            
            return {
                label: `${vital.symbol} ${vital.name}`,
                data: normalizedData,
                borderColor: 'transparent',
                backgroundColor: vital.color,
                fill: false,
                showLine: false,
                pointStyle: this.createSymbolCanvas(vital.symbol, vital.color),
                pointRadius: 8,
                pointBackgroundColor: vital.color,
                pointBorderColor: vital.color,
                pointHoverRadius: 10,
                borderWidth: showLine ? 2 : 0,
                tension: 0,
                spanGaps: false
            };
        });

        this.chart.data.datasets = datasets;
        this.chart.update('none');
        
        this.updateCurrentVitalValues();
        this.renderTimeseriesData();
        this.updateChartRangeLabels();
    }

    updateChartTimeAxis() {
        if (!this.chart) return;
        
        const timeFrame = parseInt(document.getElementById('timeFrame').value);
        const maxMinutes = timeFrame * 60;
        
        this.chart.options.scales.x.max = maxMinutes;
        this.chart.update('none');
        
        this.updateChartEventIcons();
    }

    createSymbolCanvas(symbol, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = color;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbol, 8, 8);
        
        return canvas;
    }

    parseTime(timeString) {
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        return date;
    }

    formatTimeForInput(dateTime) {
        if (typeof dateTime === 'string') return dateTime;
        if (dateTime instanceof Date) {
            return dateTime.toTimeString().slice(0, 5);
        }
        return '';
    }

    getRoomStartTime() {
        const roomStartEvent = this.remarks.find(r => r.text.includes('手術室開始'));
        return roomStartEvent ? roomStartEvent.time : this.startTime;
    }

    openEditModal(type, item) {
        this.currentEditType = type;
        this.currentEditItem = item;
        
        const modal = document.getElementById('editModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('editForm');
        
        let formHTML = '';
        
        if (type === 'drug') {
            title.textContent = '薬剤編集';
            formHTML = `
                <div class="edit-form-group">
                    <label>薬剤名:</label>
                    <input type="text" id="editDrugName" value="${item.name}" readonly>
                </div>
                <div class="edit-form-group">
                    <label>投与量:</label>
                    <input type="text" id="editDrugDose" value="${item.dose}">
                </div>
                <div class="edit-form-group">
                    <label>時刻:</label>
                    <input type="time" id="editDrugTime" value="${this.formatTimeForInput(item.time)}">
                </div>
            `;
        } else if (type === 'fluid') {
            const fluidEntries = this.ivFluids.filter(f => f.name === item.name)
                .sort((a, b) => a.startTime - b.startTime);
            
            let previousWasEnd;
            if (item.previousWasEnd !== undefined) {
                previousWasEnd = item.previousWasEnd;
            } else {
                const currentIndex = fluidEntries.findIndex(f => f === item);
                const previousEntry = currentIndex > 0 ? fluidEntries[currentIndex - 1] : null;
                previousWasEnd = previousEntry && previousEntry.endTime;
            }
            
            title.textContent = '輸液編集';
            formHTML = `
                <div class="edit-form-group">
                    <label>輸液名:</label>
                    <input type="text" id="editFluidName" value="${item.name}" readonly>
                </div>
                <div class="edit-form-group">
                    <label>${previousWasEnd ? '開始時残量' : '終了時残量'}(ml):</label>
                    <input type="number" id="editFluidVolume" value="${item.initialVolume}">
                </div>
                <div class="edit-form-group">
                    <label>時刻:</label>
                    <input type="time" id="editFluidTime" value="${this.formatTimeForInput(item.startTime)}">
                </div>
            `;
        }else if (type === 'remark') {
            title.textContent = 'イベント編集';
            formHTML = `
                <div class="edit-form-group">
                    <label>イベント:</label>
                    <input type="text" id="editRemarkText" value="${item.text}">
                </div>
                <div class="edit-form-group">
                    <label>メモ:</label>
                    <textarea id="editRemarkMemo" rows="3" placeholder="メモ">${item.memo || ''}</textarea>
                </div>
                <div class="edit-form-group">
                    <label>時刻:</label>
                    <input type="time" id="editRemarkTime" value="${this.formatTimeForInput(item.time)}">
                </div>
            `;
        }
        
        form.innerHTML = formHTML;
        modal.style.display = 'block';
    }
    
    closeEditModal() {
        document.getElementById('editModal').style.display = 'none';
        this.currentEditType = null;
        this.currentEditItem = null;
        this.currentInputType = null;
        this.currentInputConfig = null;
    }
    
    saveEdit() {
        const type = this.currentEditType || this.currentInputType;
        const item = this.currentEditItem;
        
        if (type === 'remark') {
            const text = document.getElementById('editRemarkText').value;
            const time = document.getElementById('editRemarkTime').value;
            const memo = document.getElementById('editRemarkMemo').value;
            
            if (text && time) {
                item.text = text;
                item.time = this.parseTime(time);
                item.memo = memo;
                this.updateTimelines();
            }
        } else if (type === 'drug') {
            if (this.currentInputType === 'drug') {
                const dose = parseFloat(document.getElementById('inputDrugDose').value);
                const time = document.getElementById('inputDrugTime').value;
                
                if (!isNaN(dose) && time) {
                    const drugConfig = this.currentInputConfig;
                    const drugTime = this.parseTime(time);
                    
                    if (dose === 0 && drugConfig.continuous) {
                        const existingDrug = this.drugs.filter(d => d.name === drugConfig.name && d.continuous && !d.endTime).pop();
                        if (existingDrug) {
                            existingDrug.endTime = drugTime;
                        }
                    } else {
                        this.drugs.push({
                            name: drugConfig.name,
                            unit: drugConfig.unit,
                            dose: dose,
                            color: drugConfig.color,
                            continuous: drugConfig.continuous,
                            time: drugTime
                        });
                    }
                    
                    this.updateTimelines();
                }
            } else {
                const dose = parseFloat(document.getElementById('editDrugDose').value);
                const time = document.getElementById('editDrugTime').value;
                
                if (!isNaN(dose) && time) {
                    item.dose = dose;
                    item.time = this.parseTime(time);
                    this.updateTimelines();
                }
            }
        } else if (type === 'fluid') {
            if (this.currentInputType === 'fluid') {
                const volume = parseInt(document.getElementById('inputFluidVolume').value);
                const time = document.getElementById('inputFluidTime').value;
                
                if (!isNaN(volume) && time) {
                    const fluidConfig = this.currentInputConfig;
                    const fluidTime = this.parseTime(time);
                    
                    if (volume === 0) {
                        const existingFluid = this.ivFluids.filter(f => f.name === fluidConfig.name && f.continuous && !f.endTime).pop();
                        if (existingFluid) {
                            existingFluid.endTime = fluidTime;
                        }
                    } else {
                        this.ivFluids.push({
                            name: fluidConfig.name,
                            initialVolume: volume,
                            startTime: fluidTime,
                            continuous: true,
                            endTime: null,
                            endVolume: null
                        });
                    }
                    
                    this.updateTimelines();
                }
            } else if (this.currentInputType === 'fluid-end') {
                const endVolume = parseInt(document.getElementById('inputFluidEndVolume').value);
                const time = document.getElementById('inputFluidTime').value;
                
                if (!isNaN(endVolume) && time && this.currentActiveFluid) {
                    this.currentActiveFluid.endTime = this.parseTime(time);
                    this.currentActiveFluid.endVolume = endVolume;
                    this.updateTimelines();
                }
            } else {
                const volume = parseInt(document.getElementById('editFluidVolume').value);
                const time = document.getElementById('editFluidTime').value;
                
                if (!isNaN(volume) && time) {
                    item.initialVolume = volume;
                    item.startTime = this.parseTime(time);
                    this.updateTimelines();
                }
            }
        }
        
        this.closeEditModal();
    }

    isTrackingEvent(text) {
        return text.includes('麻酔開始') || text.includes('手術開始') || text.includes('手術室開始');
    }

    startElapsedTimer(eventType, startTime) {
        if (!this.elapsedTimers) this.elapsedTimers = {};
        
        if (this.elapsedTimers[eventType]) {
            clearInterval(this.elapsedTimers[eventType]);
        }
        
        this.elapsedTimers[eventType] = setInterval(() => {
            this.updateRemarksTimeline();
        }, 60000);
    }

    stopElapsedTimer(eventType) {
        if (this.elapsedTimers && this.elapsedTimers[eventType]) {
            clearInterval(this.elapsedTimers[eventType]);
            delete this.elapsedTimers[eventType];
        }
    }

    getElapsedTime(eventText, startTime) {
        const endEvent = this.remarks.find(r => 
            (eventText.includes('麻酔開始') && r.text.includes('麻酔終了')) ||
            (eventText.includes('手術開始') && r.text.includes('手術終了')) ||
            (eventText.includes('手術室開始') && r.text.includes('手術室終了'))
        );
        
        const endTime = endEvent ? endEvent.time : new Date();
        const elapsed = Math.floor((endTime - startTime) / (1000 * 60));
        const hours = Math.floor(elapsed / 60);
        const minutes = elapsed % 60;
        
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }

    async startVitalSignAcquisition() {
        const toggle = document.getElementById('acquisitionToggle');
        const toggleLabel = document.querySelector('.toggle-label');
        toggle.disabled = true;
        toggleLabel.textContent = '取得中...';
        
        this.isAcquiring = true;
        this.acquisitionStartTime = new Date();
        
        this.chartStartTime = new Date(this.acquisitionStartTime);
        this.chartStartTime.setMinutes(0, 0, 0);
        
        this.vitalSigns.forEach(vital => {
            vital.data = [];
        });
        
        const intervalMs = parseInt(document.getElementById('vitalUpdateInterval').value) * 1000;
        this.acquisitionInterval = setInterval(async () => {
            if (this.isVitalRecorderConnected) {
                console.log('Fetching VitalRecorder data...');
                const rawVitalRecorderData = await this.fetchRawVitalRecorderData();
                console.log('Raw VitalRecorder data:', rawVitalRecorderData);
                
                if (rawVitalRecorderData && rawVitalRecorderData.data && Object.keys(rawVitalRecorderData.data).length > 0) {
                    this.processVitalDBData(rawVitalRecorderData);
                    this.updateCurrentVitalValues(rawVitalRecorderData);
                    this.updateChart();
                } else {
                    console.warn('VitalRecorder data unavailable');
                    this.updateCurrentVitalValues();
                }
            } else {
                console.warn('VitalRecorder not connected');
                this.updateCurrentVitalValues();
            }
        }, intervalMs);
        
        setTimeout(() => {
            toggleLabel.textContent = '取得停止';
            toggle.disabled = false;
        }, 1000);
    }

    stopVitalSignAcquisition() {
        const toggle = document.getElementById('acquisitionToggle');
        const toggleLabel = document.querySelector('.toggle-label');
        
        if (this.acquisitionInterval) {
            clearInterval(this.acquisitionInterval);
            this.acquisitionInterval = null;
        }
        
        this.isAcquiring = false;
        toggle.checked = false;
        toggleLabel.textContent = '取得開始';
        toggle.disabled = false;
    }

    generateRealTimeVitalData() {
        console.log('generateRealTimeVitalData called - this should not be used with real VitalDB data');
        return;
    }

    processVitalDBData(vitalRecorderData) {
        if (!this.isAcquiring) return;
        
        const now = new Date();
        const chartStartTime = this.chartStartTime || this.acquisitionStartTime;
        const minutesSinceChartStart = Math.floor((now - chartStartTime) / (1000 * 60));
        
        console.log('Processing VitalRecorder data:', vitalRecorderData);
        
        this.vitalSigns.forEach(vital => {
            const vitalToParamName = {
                'HR': 'HR',
                'SpO2': 'SpO2',
                'sNIBP': 'SBP',
                'dNIBP': 'DBP',
                'sABP': 'SBP',
                'dABP': 'DBP',
                'BT': 'TEMP',
                'EtCO2': 'ETCO2',
                'EtGas': 'ETGAS'
            };
            
            const targetVitalType = vitalToParamName[vital.name];
            
            let foundValue = null;
            let foundTrack = null;
            
            if (this.vitalRecorderConfig.parameterMappings) {
                for (const [trackName, mapping] of Object.entries(this.vitalRecorderConfig.parameterMappings)) {
                    if (mapping.enabled && mapping.label === targetVitalType) {
                        const param = this.vitalRecorderConfig.availableParameters.find(p => p.source_track === trackName);
                        if (param && vitalRecorderData && vitalRecorderData.data && vitalRecorderData.data[param.name]) {
                            const paramData = vitalRecorderData.data[param.name];
                            if (paramData.value !== null && paramData.value !== undefined) {
                                foundValue = paramData.value;
                                foundTrack = trackName;
                                break;
                            }
                        }
                    }
                }
            }
            
            if (foundValue !== null) {
                const vitalConfig = this.vitalSignConfig.find(v => v.name === vital.name);
                const intervalMinutes = vitalConfig ? parseFloat(vitalConfig.interval) : 1;
                
                const lastDataPoint = vital.data[vital.data.length - 1];
                if (!lastDataPoint || (minutesSinceChartStart - lastDataPoint.x) >= intervalMinutes) {
                    const [min, max] = vital.range.split('-').map(Number);
                    const clampedValue = Math.max(min, Math.min(max, foundValue));
                    
                    vital.data.push({
                        x: minutesSinceChartStart,
                        y: clampedValue
                    });
                    
                    console.log(`Updated ${vital.name} with value ${foundValue} from track ${foundTrack} (interval: ${intervalMinutes}min)`);
                } else {
                    console.log(`Skipping ${vital.name} update - interval not reached (${intervalMinutes}min required)`);
                }
            } else {
                console.log(`No mapped track found for ${vital.name} (${targetVitalType})`);
            }
            
            if (vital.data.length > 96) {
                vital.data.shift();
            }
        });
    }

    updateChartEventIcons() {
        const existingIcons = document.querySelectorAll('.chart-event-icon');
        existingIcons.forEach(icon => icon.remove());

        if (!this.remarks || this.remarks.length === 0 || !this.chart) return;

        const timeFrame = parseInt(document.getElementById('timeFrame').value);
        const chartContainer = document.querySelector('.chart-container');
        
        const chartStartTime = this.chartStartTime || this.acquisitionStartTime;
        if (!chartStartTime) return;
        
        let iconContainer = document.getElementById('chart-event-icon-container');
        if (!iconContainer) {
            iconContainer = document.createElement('div');
            iconContainer.id = 'chart-event-icon-container';
            iconContainer.style.position = 'absolute';
            iconContainer.style.top = '0';
            iconContainer.style.left = '0';
            iconContainer.style.width = '100%';
            iconContainer.style.height = '100%';
            iconContainer.style.pointerEvents = 'none';
            iconContainer.style.zIndex = '50';
            iconContainer.style.background = 'transparent';
            iconContainer.style.overflow = 'visible';
            chartContainer.appendChild(iconContainer);
        }
        
        
        this.remarks.forEach(remark => {
            const minutesSinceChartStart = (remark.time - chartStartTime) / (1000 * 60);
            
            if (minutesSinceChartStart >= 0 && minutesSinceChartStart <= timeFrame * 60) {
                const xPixel = this.chart.scales.x.getPixelForValue(minutesSinceChartStart);
                const chartArea = this.chart.chartArea;
                
                const containerRect = chartContainer.getBoundingClientRect();
                const canvasRect = this.chart.canvas.getBoundingClientRect();
                const offsetX = canvasRect.left - containerRect.left;
                
                
                const remarkConfig = this.remarksConfig.find(config => config.name === remark.text);
                const iconColor = remarkConfig ? remarkConfig.color : '#FF6600';
                
                const icon = document.createElement('div');
                icon.className = 'chart-event-icon';
                icon.style.position = 'absolute';
                icon.style.left = `${offsetX + xPixel - 10}px`;
                icon.style.bottom = '15px';
                icon.style.color = iconColor;
                icon.style.fontSize = '20px';
                icon.style.fontWeight = 'bold';
                icon.style.cursor = 'pointer';
                icon.style.pointerEvents = 'auto';
                icon.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
                icon.style.zIndex = '100';
                icon.style.lineHeight = '1';
                icon.style.display = 'block';
                icon.textContent = remark.icon;
                
                icon.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openEditModal('remark', remark);
                });
                
                icon.title = `${remark.time.toLocaleTimeString('ja-JP', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                })}: ${remark.text}`;
                
                iconContainer.appendChild(icon);
            }
        });
    }

    async connectVitalRecorder() {
        console.log('connectVitalRecorder called');
        try {
            console.log('Attempting to connect to:', `${this.vitalRecorderConfig.serviceURL}/api/start-monitoring`);
            const response = await fetch(`${this.vitalRecorderConfig.serviceURL}/api/start-monitoring`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            console.log('Connection response status:', response.status, 'OK:', response.ok);

            if (response.ok) {
                this.isVitalRecorderConnected = true;
                console.log('VitalRecorder connected successfully, isVitalRecorderConnected:', this.isVitalRecorderConnected);
                this.updateVitalRecorderStatus('接続済み', 'connected');
                
                const savedDirectory = this.vitalRecorderConfig.vitaldbDirectory || document.getElementById('vitalrecorderDirectory').value;
                if (savedDirectory && savedDirectory.trim()) {
                    console.log('Sending saved directory to backend:', savedDirectory);
                    await this.updateVitalRecorderDirectory(savedDirectory);
                }
                
                console.log('About to refresh parameters after connection');
                await this.refreshVitalRecorderParameters();
                this.startVitalRecorderStatusMonitoring();
                
                const initialData = await this.fetchRawVitalRecorderData();
                if (initialData) {
                    console.log('Fetched initial VitalRecorder data for display:', initialData);
                    this.updateCurrentVitalValues(initialData);
                }
                
                this.startContinuousVitalDataUpdate();
            } else {
                console.error('Connection failed with status:', response.status);
                const errorText = await response.text();
                console.error('Error response:', errorText);
                this.updateVitalRecorderStatus('接続失敗', 'error');
            }
        } catch (error) {
            console.error('VitalRecorder connection error:', error);
            console.error('Error stack:', error.stack);
            this.updateVitalRecorderStatus('接続エラー', 'error');
        }
    }

    async refreshVitalRecorderParameters() {
        console.log('refreshVitalRecorderParameters called, connected:', this.isVitalRecorderConnected);
        
        if (!this.isVitalRecorderConnected) {
            console.log('Not connected to VitalRecorder, skipping parameter refresh');
            return;
        }

        try {
            console.log('Fetching parameters from:', `${this.vitalRecorderConfig.serviceURL}/api/parameters`);
            const response = await fetch(`${this.vitalRecorderConfig.serviceURL}/api/parameters`);
            console.log('Response status:', response.status, 'OK:', response.ok);
            
            if (response.ok) {
                const data = await response.json();
                console.log('Received parameter data:', data);
                console.log('Parameters array:', data.parameters);
                console.log('Parameters length:', data.parameters ? data.parameters.length : 'undefined');
                
                this.vitalRecorderConfig.availableParameters = data.parameters || [];
                console.log('Set availableParameters to:', this.vitalRecorderConfig.availableParameters);
                console.log('About to setup default parameter mappings');
                this.setupDefaultParameterMappings();
                console.log('About to call renderParameterMappingUI');
                this.renderParameterMappingUI();
            } else {
                console.error('Failed to fetch parameters, status:', response.status);
                const errorText = await response.text();
                console.error('Error response:', errorText);
            }
        } catch (error) {
            console.error('Error fetching parameters:', error);
            console.error('Error stack:', error.stack);
        }
    }

    async updateVitalRecorderConfig() {
        if (!this.isVitalRecorderConnected) {
            return;
        }

        try {
            await fetch(`${this.vitalRecorderConfig.serviceURL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    data_delay_seconds: this.vitalRecorderConfig.dataDelaySeconds,
                    sampling_rate_hz: this.vitalRecorderConfig.samplingRateHz
                })
            });
        } catch (error) {
            console.error('Error updating VitalRecorder config:', error);
        }
    }

    async updateVitalRecorderDirectory(directory) {
        console.log('Updating VitalRecorder directory to:', directory);
        const currentVitalFileDiv = document.getElementById('currentVitalFile');
        
        try {
            const response = await fetch(`${this.vitalRecorderConfig.serviceURL}/api/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    vitaldb_directory: directory
                })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Directory update response:', data);
                this.vitalRecorderConfig.vitaldbDirectory = directory;
                
                if (currentVitalFileDiv) {
                    currentVitalFileDiv.textContent = 'フォルダ更新完了';
                    currentVitalFileDiv.style.color = '#00CC00';
                }
                
                await this.refreshVitalRecorderParameters();
                
                const statusResponse = await fetch(`${this.vitalRecorderConfig.serviceURL}/api/status`);
                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    if (statusData.current_file) {
                        if (currentVitalFileDiv) {
                            const fileName = statusData.current_file.split('/').pop().split('\\').pop();
                            currentVitalFileDiv.textContent = `現在のファイル: ${fileName}`;
                            currentVitalFileDiv.style.color = '#00CC00';
                        }
                    } else {
                        if (currentVitalFileDiv) {
                            currentVitalFileDiv.textContent = 'バイタルファイルが見つかりません';
                            currentVitalFileDiv.style.color = '#FF6600';
                        }
                    }
                }
            } else {
                console.error('Failed to update directory:', response.status);
                if (currentVitalFileDiv) {
                    currentVitalFileDiv.textContent = 'フォルダ更新失敗';
                    currentVitalFileDiv.style.color = '#FF0000';
                }
            }
        } catch (error) {
            console.error('Error updating VitalRecorder directory:', error);
            if (currentVitalFileDiv) {
                currentVitalFileDiv.textContent = '接続エラー';
                currentVitalFileDiv.style.color = '#FF0000';
            }
        }
    }

    renderParameterMappingUI() {
        console.log('renderParameterMappingUI called');
        
        const parameterMappingContent = document.getElementById('parameter-mapping-content');
        if (parameterMappingContent && parameterMappingContent.classList.contains('collapsed')) {
            console.log('Expanding parameter mapping section');
            this.toggleSection('parameter-mapping');
        }
        
        const container = document.getElementById('parameterMappingList');
        console.log('Container element:', container);
        
        if (!container) {
            console.error('parameterMappingList container not found!');
            return;
        }
        
        container.innerHTML = '';

        console.log('Available parameters:', this.vitalRecorderConfig.availableParameters);
        console.log('Available parameters length:', this.vitalRecorderConfig.availableParameters ? this.vitalRecorderConfig.availableParameters.length : 'undefined');

        if (!this.vitalRecorderConfig.availableParameters || this.vitalRecorderConfig.availableParameters.length === 0) {
            console.log('No parameters available, showing message');
            container.innerHTML = '<p>利用可能なパラメータがありません</p>';
            return;
        }

        this.setupDefaultParameterMappings();

        console.log('Rendering', this.vitalRecorderConfig.availableParameters.length, 'parameters');
        
        this.vitalRecorderConfig.availableParameters.forEach((param, index) => {
            console.log(`Rendering parameter ${index}:`, param);
            
            if (!param || !param.source_track) {
                console.warn('Invalid parameter object:', param);
                return;
            }
            
            const mappingDiv = document.createElement('div');
            mappingDiv.className = 'parameter-mapping-item';
            
            const trackName = param.source_track;
            const currentMapping = this.vitalRecorderConfig.parameterMappings[trackName] || {};
            const precisionType = this.getParameterPrecisionType(currentMapping.label || param.name);
            
            mappingDiv.innerHTML = `
                <div class="parameter-info">
                    <strong>${trackName}</strong>
                    <span class="parameter-unit">${param.unit || ''}</span>
                    <span class="parameter-precision">${precisionType}</span>
                </div>
                <div class="mapping-controls-primary">
                    <label class="enable-control">
                        <input type="checkbox" 
                               data-param="${trackName}" 
                               ${currentMapping.enabled ? 'checked' : ''}
                               onchange="app.toggleParameterMapping('${trackName}', this.checked)">
                        使用する
                    </label>
                    <label class="label-control">
                        ラベル:
                        <select data-param="${trackName}" 
                                onchange="app.updateParameterLabel('${trackName}', this.value)"
                                ${!currentMapping.enabled ? 'disabled' : ''}>
                            <option value="">バイタルサインを選択</option>
                            ${this.vitalSignConfig.map(vital => 
                                `<option value="${vital.name}" ${currentMapping.label === vital.name ? 'selected' : ''}>${vital.name}</option>`
                            ).join('')}
                        </select>
                    </label>
                </div>
            `;
            
            container.appendChild(mappingDiv);
            console.log(`Parameter ${trackName} rendered successfully`);
        });
        
        console.log('Parameter mapping UI rendering complete');
    }

    toggleParameterMapping(paramName, enabled) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].enabled = enabled;
        
        const select = document.querySelector(`select[data-param="${paramName}"]`);
        const decimalInput = document.querySelector(`.decimal-input[data-param="${paramName}"]`);
        const intervalInput = document.querySelector(`.interval-input[data-param="${paramName}"]`);
        const rangeMinInput = document.querySelector(`.range-min-input[data-param="${paramName}"]`);
        const rangeMaxInput = document.querySelector(`.range-max-input[data-param="${paramName}"]`);
        const continuousInput = document.querySelector(`.continuous-input[data-param="${paramName}"]`);
        
        if (select) {
            select.disabled = !enabled;
        }
        if (decimalInput) {
            decimalInput.disabled = !enabled;
        }
        if (intervalInput) {
            intervalInput.disabled = !enabled;
        }
        if (rangeMinInput) {
            rangeMinInput.disabled = !enabled;
        }
        if (rangeMaxInput) {
            rangeMaxInput.disabled = !enabled;
        }
        if (continuousInput) {
            continuousInput.disabled = !enabled;
        }
        
        this.saveSettings();
    }

    updateParameterLabel(paramName, label) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].label = label;
        
        const precisionType = this.getParameterPrecisionType(label);
        const precisionSpan = document.querySelector(`[data-param="${paramName}"]`).closest('.parameter-mapping-item').querySelector('.parameter-precision');
        if (precisionSpan) {
            precisionSpan.textContent = precisionType;
        }
        
        this.saveSettings();
    }

    updateParameterDecimals(paramName, decimals) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].decimals = decimals;
        
        const label = this.vitalRecorderConfig.parameterMappings[paramName].label;
        const precisionType = decimals === 0 ? '整数値' : `小数点${decimals}桁`;
        const precisionSpan = document.querySelector(`[data-param="${paramName}"]`).closest('.parameter-mapping-item').querySelector('.parameter-precision');
        if (precisionSpan) {
            precisionSpan.textContent = precisionType;
        }
        
        this.saveSettings();
    }
    
    updateParameterRange(paramName, range) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        const rangePattern = /^\d+(\.\d+)?-\d+(\.\d+)?$/;
        if (!rangePattern.test(range)) {
            alert('表示レンジは "最小値-最大値" の形式で入力してください（例: 40-150）');
            return;
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].range = range;
        this.saveSettings();
    }
    
    updateParameterRangeMin(paramName, rangeMin) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].rangeMin = rangeMin;
        
        const rangeMax = this.vitalRecorderConfig.parameterMappings[paramName].rangeMax;
        if (rangeMax !== undefined) {
            this.vitalRecorderConfig.parameterMappings[paramName].range = `${rangeMin}-${rangeMax}`;
        }
        
        this.saveSettings();
    }
    
    updateParameterRangeMax(paramName, rangeMax) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].rangeMax = rangeMax;
        
        const rangeMin = this.vitalRecorderConfig.parameterMappings[paramName].rangeMin;
        if (rangeMin !== undefined) {
            this.vitalRecorderConfig.parameterMappings[paramName].range = `${rangeMin}-${rangeMax}`;
        }
        
        this.saveSettings();
    }
    
    updateParameterInterval(paramName, interval) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        if (interval <= 0) {
            alert('表示間隔は0より大きい値を入力してください');
            return;
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].interval = interval;
        this.saveSettings();
    }
    
    updateParameterContinuous(paramName, continuous) {
        if (!this.vitalRecorderConfig.parameterMappings[paramName]) {
            this.vitalRecorderConfig.parameterMappings[paramName] = {};
        }
        
        this.vitalRecorderConfig.parameterMappings[paramName].continuous = continuous;
        this.saveSettings();
    }

    setupDefaultParameterMappings() {
        const trackToVitalMappings = {
            'Demo/PLETH_HR': { enabled: true, label: 'HR' },
            'Demo/HR': { enabled: true, label: 'HR' },
            'Solar8000/HR': { enabled: true, label: 'HR' },
            'Solar8000/PLETH_HR': { enabled: true, label: 'HR' },
            'PLETH_HR': { enabled: true, label: 'HR' },
            'HR': { enabled: true, label: 'HR' },
            
            'Demo/PLETH_SPO2': { enabled: true, label: 'SpO2' },
            'Solar8000/PLETH_SPO2': { enabled: true, label: 'SpO2' },
            'PLETH_SPO2': { enabled: true, label: 'SpO2' },
            'SPO2': { enabled: true, label: 'SpO2' },
            
            'Demo/NIBP_SBP': { enabled: true, label: 'SBP' },
            'Demo/ART_SBP': { enabled: true, label: 'SBP' },
            'Solar8000/NIBP_SBP': { enabled: true, label: 'SBP' },
            'Solar8000/ART_SBP': { enabled: true, label: 'SBP' },
            'NIBP_SBP': { enabled: true, label: 'SBP' },
            'ART_SBP': { enabled: true, label: 'SBP' },
            
            'Demo/NIBP_DBP': { enabled: true, label: 'DBP' },
            'Demo/ART_DBP': { enabled: true, label: 'DBP' },
            'Solar8000/NIBP_DBP': { enabled: true, label: 'DBP' },
            'Solar8000/ART_DBP': { enabled: true, label: 'DBP' },
            'NIBP_DBP': { enabled: true, label: 'DBP' },
            'ART_DBP': { enabled: true, label: 'DBP' },
            
            'Demo/BT': { enabled: true, label: 'TEMP' },
            'Solar8000/BT': { enabled: true, label: 'TEMP' },
            'BT': { enabled: true, label: 'TEMP' },
            'TEMP': { enabled: true, label: 'TEMP' },
            
            'Demo/RR': { enabled: true, label: 'RR' },
            'Demo/RR_CO2': { enabled: true, label: 'RR' },
            'Solar8000/VENT_RR': { enabled: true, label: 'RR' },
            'Solar8000/RR_CO2': { enabled: true, label: 'RR' },
            'RR': { enabled: true, label: 'RR' },
            'RR_CO2': { enabled: true, label: 'RR' },
            'VENT_RR': { enabled: true, label: 'RR' },
            
            'Demo/ETCO2': { enabled: true, label: 'ETCO2' },
            'Solar8000/ETCO2': { enabled: true, label: 'ETCO2' },
            'ETCO2': { enabled: true, label: 'ETCO2' },
            'CO2': { enabled: true, label: 'ETCO2' }
        };

        this.vitalRecorderConfig.availableParameters.forEach(param => {
            const trackName = param.source_track;
            if (!this.vitalRecorderConfig.parameterMappings[trackName] && trackToVitalMappings[trackName]) {
                this.vitalRecorderConfig.parameterMappings[trackName] = trackToVitalMappings[trackName];
            }
        });
    }

    getParameterPrecisionType(paramName) {
        const customMapping = Object.values(this.vitalRecorderConfig.parameterMappings).find(mapping => mapping.label === paramName);
        if (customMapping && customMapping.decimals !== undefined) {
            return customMapping.decimals === 0 ? '整数値' : `小数点${customMapping.decimals}桁`;
        }
        
        const vitalConfig = this.vitalSignConfig.find(vital => vital.name === paramName);
        if (vitalConfig && vitalConfig.decimals !== undefined) {
            return vitalConfig.decimals === 0 ? '整数値' : `小数点${vitalConfig.decimals}桁`;
        }
        
        const vitalToParamName = {
            '心拍数': 'HR',
            '酸素飽和度': 'SpO2',
            '収縮期血圧': 'SBP',
            '拡張期血圧': 'DBP',
            '体温': 'TEMP',
            '呼気二酸化炭素': 'ETCO2',
            '呼吸数': 'RR'
        };
        
        const mappedParam = vitalToParamName[paramName] || paramName;
        const integerParams = ['HR', 'SBP', 'DBP', 'RR', 'ETCO2'];
        return integerParams.includes(mappedParam) ? '整数値' : '小数点1桁';
    }

    getDefaultDecimals(paramName) {
        const vitalConfig = this.vitalSignConfig.find(vital => vital.name === paramName);
        if (vitalConfig && vitalConfig.decimals !== undefined) {
            return vitalConfig.decimals;
        }
        
        const vitalToParamName = {
            '心拍数': 'HR',
            '酸素飽和度': 'SpO2',
            '収縮期血圧': 'SBP',
            '拡張期血圧': 'DBP',
            '体温': 'TEMP',
            '呼気二酸化炭素': 'ETCO2',
            '呼吸数': 'RR'
        };
        
        const mappedParam = vitalToParamName[paramName] || paramName;
        return mappedParam === 'TEMP' ? 1 : 0;
    }
    
    getDefaultRange(paramName) {
        const vitalConfig = this.vitalSignConfig.find(vital => vital.name === paramName);
        if (vitalConfig && vitalConfig.range) {
            return vitalConfig.range;
        }
        
        const defaultRanges = {
            'HR': '40-150',
            'SpO2': '80-100',
            'SBP': '60-220',
            'DBP': '40-120',
            'TEMP': '35-40',
            'RR': '10-30',
            'ETCO2': '20-60'
        };
        
        const vitalToParamName = {
            '心拍数': 'HR',
            '酸素飽和度': 'SpO2',
            '収縮期血圧': 'SBP',
            '拡張期血圧': 'DBP',
            '体温': 'TEMP',
            '呼気二酸化炭素': 'ETCO2',
            '呼吸数': 'RR'
        };
        
        const mappedParam = vitalToParamName[paramName] || paramName;
        return defaultRanges[mappedParam] || '0-100';
    }
    
    getDefaultRangeMin(paramName) {
        const range = this.getDefaultRange(paramName);
        return parseFloat(range.split('-')[0]);
    }
    
    getDefaultRangeMax(paramName) {
        const range = this.getDefaultRange(paramName);
        return parseFloat(range.split('-')[1]);
    }
    
    getDefaultInterval(paramName) {
        const vitalConfig = this.vitalSignConfig.find(vital => vital.name === paramName);
        if (vitalConfig && vitalConfig.interval !== undefined) {
            return vitalConfig.interval;
        }
        
        const defaultIntervals = {
            'HR': 5,
            'SpO2': 2,
            'SBP': 10,
            'DBP': 10,
            'TEMP': 0.5,
            'RR': 5,
            'ETCO2': 5
        };
        
        const vitalToParamName = {
            '心拍数': 'HR',
            '酸素飽和度': 'SpO2',
            '収縮期血圧': 'SBP',
            '拡張期血圧': 'DBP',
            '体温': 'TEMP',
            '呼気二酸化炭素': 'ETCO2',
            '呼吸数': 'RR'
        };
        
        const mappedParam = vitalToParamName[paramName] || paramName;
        return defaultIntervals[mappedParam] || 1;
    }
    
    getDefaultContinuous(paramName) {
        const vitalConfig = this.vitalSignConfig.find(vital => vital.name === paramName);
        if (vitalConfig && vitalConfig.continuous !== undefined) {
            return vitalConfig.continuous;
        }
        
        const defaultContinuous = {
            'HR': true,
            'SpO2': true,
            'SBP': true,
            'DBP': true,
            'TEMP': true,
            'RR': false,
            'ETCO2': false
        };
        
        const vitalToParamName = {
            '心拍数': 'HR',
            '酸素飽和度': 'SpO2',
            '収縮期血圧': 'SBP',
            '拡張期血圧': 'DBP',
            '体温': 'TEMP',
            '呼気二酸化炭素': 'ETCO2',
            '呼吸数': 'RR'
        };
        
        const mappedParam = vitalToParamName[paramName] || paramName;
        return defaultContinuous[mappedParam] || false;
    }

    formatVitalValue(paramName, rawValue) {
        const customMapping = Object.values(this.vitalRecorderConfig.parameterMappings).find(mapping => mapping.label === paramName);
        if (customMapping && customMapping.decimals !== undefined) {
            if (customMapping.decimals === 0) {
                return Math.round(rawValue);
            } else {
                return Math.round(rawValue * Math.pow(10, customMapping.decimals)) / Math.pow(10, customMapping.decimals);
            }
        }
        
        const vitalConfig = this.vitalSignConfig.find(vital => vital.name === paramName);
        if (vitalConfig && vitalConfig.decimals !== undefined) {
            if (vitalConfig.decimals === 0) {
                return Math.round(rawValue);
            } else {
                return Math.round(rawValue * Math.pow(10, vitalConfig.decimals)) / Math.pow(10, vitalConfig.decimals);
            }
        }
        
        const paramToVitalName = {
            'HR': '心拍数',
            'SpO2': '酸素飽和度',
            'SBP': '収縮期血圧',
            'DBP': '拡張期血圧',
            'TEMP': '体温',
            'ETCO2': '呼気二酸化炭素',
            'RR': '呼吸数'
        };
        
        const vitalName = paramToVitalName[paramName];
        if (vitalName) {
            const vitalConfigByParam = this.vitalSignConfig.find(vital => vital.name === vitalName);
            if (vitalConfigByParam && vitalConfigByParam.decimals !== undefined) {
                if (vitalConfigByParam.decimals === 0) {
                    return Math.round(rawValue);
                } else {
                    return Math.round(rawValue * Math.pow(10, vitalConfigByParam.decimals)) / Math.pow(10, vitalConfigByParam.decimals);
                }
            }
        }
        
        const vitalToParamName = {
            '心拍数': 'HR',
            '酸素飽和度': 'SpO2',
            '収縮期血圧': 'SBP',
            '拡張期血圧': 'DBP',
            '体温': 'TEMP',
            '呼気二酸化炭素': 'ETCO2',
            '呼吸数': 'RR'
        };
        
        const mappedParam = vitalToParamName[paramName] || paramName;
        const integerParams = ['HR', 'SBP', 'DBP', 'RR', 'ETCO2'];
        
        if (integerParams.includes(mappedParam)) {
            return Math.round(rawValue);
        } else if (mappedParam === 'TEMP') {
            return Math.round(rawValue * 10) / 10;
        } else {
            return Math.round(rawValue * 10) / 10;
        }
    }

    async fetchVitalRecorderData() {
        if (!this.isVitalRecorderConnected) {
            return null;
        }

        try {
            const response = await fetch(`${this.vitalRecorderConfig.serviceURL}/api/vital-data`);
            if (response.ok) {
                const data = await response.json();
                return this.convertVitalRecorderToChartData(data);
            }
        } catch (error) {
            console.error('Error fetching VitalRecorder data:', error);
        }
        
        return null;
    }

    async fetchRawVitalRecorderData() {
        if (!this.isVitalRecorderConnected) {
            return null;
        }

        try {
            const response = await fetch(`${this.vitalRecorderConfig.serviceURL}/api/vital-data`);
            if (response.ok) {
                const data = await response.json();
                console.log('Raw VitalRecorder data received:', data);
                return data;
            }
        } catch (error) {
            console.error('Error fetching raw VitalRecorder data:', error);
        }
        
        return null;
    }

    convertVitalRecorderToChartData(vitalRecorderData) {
        const convertedData = {};
        
        if (!vitalRecorderData || !vitalRecorderData.data) {
            console.log('No VitalRecorder data available');
            return convertedData;
        }

        console.log('Converting VitalRecorder data:', vitalRecorderData);

        const labelToVitalName = {
            'HR': '心拍数',
            'SpO2': '酸素飽和度',
            'SBP': '収縮期血圧',
            'DBP': '拡張期血圧',
            'TEMP': '体温',
            'RR': '呼吸数',
            'ETCO2': '呼気二酸化炭素'
        };

        let hasUserMappings = false;
        Object.entries(this.vitalRecorderConfig.parameterMappings).forEach(([trackName, mapping]) => {
            if (mapping.enabled && mapping.label) {
                const paramName = trackName.split('/').pop();
                if (vitalRecorderData.data[paramName]) {
                    hasUserMappings = true;
                    const paramData = vitalRecorderData.data[paramName];
                    const vitalName = labelToVitalName[mapping.label];
                    
                    if (vitalName && paramData.value !== null && paramData.value !== undefined) {
                        convertedData[vitalName] = [{
                            time: new Date(paramData.timestamp * 1000),
                            value: paramData.value
                        }];
                        console.log(`Mapped track ${trackName} -> ${vitalName}: ${paramData.value}`);
                    }
                }
            }
        });

        if (!hasUserMappings) {
            console.log('No user parameter mappings found, using automatic mapping');
            const paramToVitalName = {
                'HR': '心拍数',
                'SpO2': '酸素飽和度',
                'SBP': '収縮期血圧',
                'DBP': '拡張期血圧',
                'TEMP': '体温',
                'RR': '呼吸数',
                'ETCO2': '呼気二酸化炭素'
            };
            
            Object.entries(vitalRecorderData.data).forEach(([paramName, paramData]) => {
                const vitalName = paramToVitalName[paramName];
                
                if (vitalName && paramData.value !== null && paramData.value !== undefined) {
                    convertedData[vitalName] = [{
                        time: new Date(paramData.timestamp * 1000),
                        value: paramData.value
                    }];
                    console.log(`Auto-mapped parameter ${paramName} -> ${vitalName}: ${paramData.value}`);
                }
            });
        }

        console.log('Final converted data:', convertedData);
        return convertedData;
    }

    startVitalRecorderStatusMonitoring() {
        if (this.vitalRecorderStatusInterval) {
            clearInterval(this.vitalRecorderStatusInterval);
        }

        this.vitalRecorderStatusInterval = setInterval(async () => {
            try {
                const response = await fetch(`${this.vitalRecorderConfig.serviceURL}/api/status`);
                if (response.ok) {
                    const status = await response.json();
                    this.updateFileAgeAlert(status.file_age_alert);
                }
            } catch (error) {
                console.error('Error checking VitalRecorder status:', error);
            }
        }, 30000); // Check every 30 seconds
    }

    startContinuousVitalDataUpdate() {
        if (this.continuousVitalUpdateInterval) {
            clearInterval(this.continuousVitalUpdateInterval);
        }

        this.continuousVitalUpdateInterval = setInterval(async () => {
            if (this.isVitalRecorderConnected) {
                try {
                    const rawVitalRecorderData = await this.fetchRawVitalRecorderData();
                    if (rawVitalRecorderData && rawVitalRecorderData.data && Object.keys(rawVitalRecorderData.data).length > 0) {
                        console.log('Continuous update: received VitalRecorder data:', rawVitalRecorderData);
                        this.updateCurrentVitalValues(rawVitalRecorderData);
                    } else {
                        console.log('Continuous update: no VitalRecorder data available');
                    }
                } catch (error) {
                    console.error('Error in continuous vital data update:', error);
                }
            }
        }, 2000); // Update every 2 seconds
    }

    stopContinuousVitalDataUpdate() {
        if (this.continuousVitalUpdateInterval) {
            clearInterval(this.continuousVitalUpdateInterval);
            this.continuousVitalUpdateInterval = null;
        }
    }

    updateVitalRecorderStatus(message, status) {
        const statusElement = document.getElementById('vitalrecorderStatus');
        statusElement.textContent = message;
        statusElement.className = `status-indicator ${status}`;
    }

    updateFileAgeAlert(alertInfo) {
        const alertElement = document.getElementById('fileAgeAlert');
        
        if (alertInfo.alert) {
            alertElement.textContent = alertInfo.message;
            alertElement.className = 'alert-indicator error';
            alertElement.style.display = 'block';
        } else {
            alertElement.style.display = 'none';
        }
    }

    async authenticateVitalDB(username, password) {
        try {
            const response = await fetch(`${this.vitalDBConfig.baseURL}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    id: username,
                    pw: password
                })
            });

            if (response.ok) {
                const data = await response.json();
                this.vitalDBConfig.accessToken = data.access_token;
                this.vitalDBConfig.username = username;
                this.vitalDBConfig.password = password;
                this.isVitalDBConnected = true;
                console.log('VitalDB authentication successful');
                return true;
            } else {
                console.error('VitalDB authentication failed:', response.status);
                return false;
            }
        } catch (error) {
            console.error('VitalDB authentication error:', error);
            return false;
        }
    }

    async refreshVitalDBToken() {
        if (!this.vitalDBConfig.username || !this.vitalDBConfig.password) {
            return false;
        }
        return await this.authenticateVitalDB(this.vitalDBConfig.username, this.vitalDBConfig.password);
    }

    async fetchVitalDBData(vrcode) {
        if (!this.isVitalDBConnected || !this.vitalDBConfig.accessToken) {
            console.warn('VitalDB not connected or no access token');
            return null;
        }

        try {
            const response = await fetch(`${this.vitalDBConfig.baseURL}/receive`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.vitalDBConfig.accessToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    vrcode: vrcode,
                    from: Math.floor(Date.now() / 1000) - 60,
                    to: Math.floor(Date.now() / 1000)
                })
            });

            if (response.status === 401) {
                const refreshed = await this.refreshVitalDBToken();
                if (refreshed) {
                    return await this.fetchVitalDBData(vrcode);
                }
                return null;
            }

            if (response.ok) {
                const data = await response.json();
                return this.convertVitalDBToChartData(data);
            } else {
                console.error('VitalDB data fetch failed:', response.status);
                return null;
            }
        } catch (error) {
            console.error('VitalDB data fetch error:', error);
            return null;
        }
    }

    convertVitalDBToChartData(vitalDBData) {
        const convertedData = {};
        
        if (!vitalDBData || !vitalDBData.rooms) {
            return convertedData;
        }

        vitalDBData.rooms.forEach(room => {
            if (room.devices) {
                room.devices.forEach(device => {
                    if (device.tracks) {
                        device.tracks.forEach(track => {
                            const vitalName = this.mapVitalDBTrackName(track.name);
                            if (vitalName && track.samples) {
                                convertedData[vitalName] = track.samples.map(sample => ({
                                    time: new Date(sample.timestamp * 1000),
                                    value: sample.value
                                }));
                            }
                        });
                    }
                });
            }
        });

        return convertedData;
    }

    mapVitalDBTrackName(trackName) {
        const mapping = {
            'HR': '心拍数',
            'SpO2': '酸素飽和度', 
            'SBP': '収縮期血圧',
            'DBP': '拡張期血圧',
            'TEMP': '体温',
            'RR': '呼吸数',
            'ETCO2': '呼気終末CO2'
        };
        
        return mapping[trackName] || null;
    }

    updateVitalDBStatus(message, status) {
        const statusElement = document.getElementById('vitaldbStatus');
        statusElement.textContent = message;
        statusElement.className = `status-indicator ${status}`;
    }

    isVitalDBDemoData(vitalDBData) {
        if (!vitalDBData || !vitalDBData.rooms) {
            return false;
        }
        
        return vitalDBData.rooms.some(room => 
            room.roomname && room.roomname.toUpperCase().includes('DEMO')
        );
    }

    renderTimeseriesData() {
        const tableBody = document.getElementById('timeseriesTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        const range = parseInt(document.getElementById('timeseriesRange')?.value || 480);
        const now = new Date();
        const startTime = new Date(now.getTime() - range * 60000);
        
        const timePoints = new Map();
        
        this.vitalSigns.forEach(vital => {
            vital.data.forEach(point => {
                const pointTime = new Date(point.time || now.getTime() - point.x * 60000);
                if (pointTime >= startTime) {
                    const timeKey = pointTime.toISOString();
                    if (!timePoints.has(timeKey)) {
                        timePoints.set(timeKey, { time: pointTime });
                    }
                    const [min, max] = vital.range.split('-').map(Number);
                    const rawValue = (point.y / 100) * (max - min) + min;
                    timePoints.get(timeKey)[vital.name] = this.formatVitalValue(vital.name, rawValue);
                }
            });
        });
        
        const sortedTimes = Array.from(timePoints.entries())
            .sort((a, b) => new Date(b[0]) - new Date(a[0]))
            .slice(0, 100);
        
        sortedTimes.forEach(([timeKey, data]) => {
            const row = document.createElement('tr');
            
            const timeCell = document.createElement('td');
            timeCell.textContent = data.time.toLocaleTimeString('ja-JP');
            row.appendChild(timeCell);
            
            const vitalOrder = ['心拍数', '収縮期血圧', '拡張期血圧', '酸素飽和度', '体温', '呼吸数', '呼気二酸化炭素'];
            vitalOrder.forEach(vitalName => {
                const cell = document.createElement('td');
                cell.textContent = data[vitalName] || '--';
                row.appendChild(cell);
            });
            
            tableBody.appendChild(row);
        });
    }
    
    renderTimeseriesData() {
        const tableBody = document.getElementById('timeseriesTableBody');
        if (!tableBody) return;
        
        tableBody.innerHTML = '';
        
        const range = parseInt(document.getElementById('timeseriesRange')?.value || 480);
        const now = new Date();
        const startTime = new Date(now.getTime() - range * 60000);
        
        const timePoints = new Map();
        
        this.vitalSigns.forEach(vital => {
            vital.data.forEach(point => {
                const pointTime = new Date(point.time || now.getTime() - point.x * 60000);
                if (pointTime >= startTime) {
                    const timeKey = pointTime.toISOString();
                    if (!timePoints.has(timeKey)) {
                        timePoints.set(timeKey, { time: pointTime });
                    }
                    const [min, max] = vital.range.split('-').map(Number);
                    const rawValue = (point.y / 100) * (max - min) + min;
                    timePoints.get(timeKey)[vital.name] = this.formatVitalValue(vital.name, rawValue);
                }
            });
        });
        
        const sortedTimes = Array.from(timePoints.entries())
            .sort((a, b) => new Date(b[0]) - new Date(a[0]))
            .slice(0, 100);
        
        sortedTimes.forEach(([timeKey, data]) => {
            const row = document.createElement('tr');
            
            const timeCell = document.createElement('td');
            timeCell.textContent = data.time.toLocaleTimeString('ja-JP');
            row.appendChild(timeCell);
            
            const vitalOrder = ['心拍数', '収縮期血圧', '拡張期血圧', '酸素飽和度', '体温', '呼吸数', '呼気二酸化炭素'];
            vitalOrder.forEach(vitalName => {
                const cell = document.createElement('td');
                cell.textContent = data[vitalName] || '--';
                row.appendChild(cell);
            });
            
            tableBody.appendChild(row);
        });
    }
    
    refreshTimeseriesData() {
        this.renderTimeseriesData();
    }

    setupFluidSelectHandler() {
        const fluidSelect = document.getElementById('fluidSelect');
        const volumeInput = document.getElementById('fluidVolume');
        
        if (fluidSelect && volumeInput) {
            fluidSelect.addEventListener('change', (e) => {
                if (e.target.value !== '') {
                    const fluidConfig = this.ivFluidConfig[parseInt(e.target.value)];
                    if (fluidConfig && fluidConfig.initialVolume) {
                        volumeInput.value = fluidConfig.initialVolume;
                    }
                } else {
                    volumeInput.value = '';
                }
            });
        }
    }

    updateChartRangeLabels() {
        const container = document.getElementById('chartRangeLabels');
        if (!container) return;
        
        container.innerHTML = '';
        
        const groupedParams = [];
        const processedGroups = new Set();
        
        this.vitalSignConfig.forEach((vital) => {
            if ((vital.name === 'sNIBP' || vital.name === 'sABP') && !processedGroups.has('BP')) {
                groupedParams.push({
                    name: 'BP',
                    symbol: '∨/∧',
                    color: vital.color,
                    range: vital.range
                });
                processedGroups.add('BP');
            } else if (!['dNIBP', 'dABP', 'sABP'].includes(vital.name)) {
                groupedParams.push(vital);
            }
        });
        
        groupedParams.forEach((vital, index) => {
            const [min, max] = vital.range.split('-').map(Number);
            const color = vital.color;
            const columnOffset = index * 15;
            
            const paramLabel = document.createElement('div');
            paramLabel.className = 'range-label param-label';
            paramLabel.style.color = color;
            paramLabel.style.top = '5%';
            paramLabel.style.left = `${columnOffset}px`;
            paramLabel.style.fontSize = '7px';
            paramLabel.style.fontWeight = 'bold';
            paramLabel.textContent = vital.name;
            
            const minLabel = document.createElement('div');
            minLabel.className = 'range-label';
            minLabel.style.color = color;
            minLabel.style.bottom = '10%';
            minLabel.style.top = 'auto';
            minLabel.style.left = `${columnOffset}px`;
            minLabel.style.fontSize = '7px';
            minLabel.textContent = min.toString();
            
            const maxLabel = document.createElement('div');
            maxLabel.className = 'range-label';
            maxLabel.style.color = color;
            maxLabel.style.top = '15%';
            maxLabel.style.bottom = 'auto';
            maxLabel.style.left = `${columnOffset}px`;
            maxLabel.style.fontSize = '7px';
            maxLabel.textContent = max.toString();
            
            const step = this.getDisplayStep(vital.name, min, max);
            for (let value = min + step; value < max; value += step) {
                const label = document.createElement('div');
                label.className = 'range-label';
                label.style.color = color;
                label.style.left = `${columnOffset}px`;
                label.style.fontSize = '7px';
                const percentage = 85 - ((value - min) / (max - min)) * 70;
                label.style.top = `${percentage}%`;
                label.textContent = value.toString();
                container.appendChild(label);
            }
            
            container.appendChild(paramLabel);
            container.appendChild(minLabel);
            container.appendChild(maxLabel);
        });
    }

    getDisplayStep(vitalName, min, max) {
        const range = max - min;
        if (vitalName.includes('NIBP') || vitalName.includes('ABP') || vitalName === 'BP') {
            return 20;
        } else if (vitalName === 'HR') {
            return 20;
        } else if (vitalName === 'SpO2') {
            return 5;
        } else if (vitalName === 'BT') {
            return 1;
        } else if (vitalName === 'EtCO2') {
            return 10;
        } else {
            return Math.ceil(range / 5);
        }
    }

    openDrugRowEditModal(drugConfig) {
        this.openEditModal('drug', {
            name: drugConfig.name,
            unit: drugConfig.unit,
            dose: drugConfig.defaultDose || 0,
            color: drugConfig.color,
            continuous: drugConfig.continuous,
            time: new Date()
        });
    }

    openFluidRowEditModal(fluid) {
        this.openEditModal('fluid', fluid);
    }

    openDrugInputModal(drugName) {
        const drugConfig = this.drugConfig.find(d => d.name === drugName);
        if (!drugConfig) return;

        const modal = document.getElementById('editModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('editForm');
        
        title.textContent = `${drugName} 投与`;
        
        const formHTML = `
            <div class="edit-form-group">
                <label>薬剤名:</label>
                <input type="text" id="inputDrugName" value="${drugName}" readonly>
            </div>
            <div class="edit-form-group">
                <label>投与量:</label>
                <input type="number" id="inputDrugDose" value="${drugConfig.defaultDose || ''}" step="0.1">
            </div>
            <div class="edit-form-group">
                <label>時刻:</label>
                <input type="time" id="inputDrugTime" value="${this.formatTimeForInput(new Date())}">
            </div>
        `;
        
        form.innerHTML = formHTML;
        modal.style.display = 'block';
        
        this.currentInputType = 'drug';
        this.currentInputConfig = drugConfig;
        
        document.getElementById('inputDrugDose').focus();
    }

    openFluidInputModal(fluidName) {
        const fluidConfig = this.ivFluidConfig.find(f => f.name === fluidName);
        if (!fluidConfig) return;

        const activeFluid = this.ivFluids.find(f => f.name === fluidName && f.continuous && !f.endTime);
        
        const modal = document.getElementById('editModal');
        const title = document.getElementById('modalTitle');
        const form = document.getElementById('editForm');
        
        if (activeFluid) {
            title.textContent = `${fluidName} 終了`;
            
            const formHTML = `
                <div class="edit-form-group">
                    <label>輸液名:</label>
                    <input type="text" id="inputFluidName" value="${fluidName}" readonly>
                </div>
                <div class="edit-form-group">
                    <label>終了時残量:</label>
                    <input type="number" id="inputFluidEndVolume" value="" placeholder="終了時残量">
                </div>
                <div class="edit-form-group">
                    <label>時刻:</label>
                    <input type="time" id="inputFluidTime" value="${this.formatTimeForInput(new Date())}">
                </div>
            `;
            
            form.innerHTML = formHTML;
            this.currentInputType = 'fluid-end';
            this.currentActiveFluid = activeFluid;
            document.getElementById('inputFluidEndVolume').focus();
        } else {
            title.textContent = `${fluidName} 開始`;
            
            const formHTML = `
                <div class="edit-form-group">
                    <label>輸液名:</label>
                    <input type="text" id="inputFluidName" value="${fluidName}" readonly>
                </div>
                <div class="edit-form-group">
                    <label>開始時残量:</label>
                    <input type="number" id="inputFluidVolume" value="${fluidConfig.initialVolume || ''}">
                </div>
                <div class="edit-form-group">
                    <label>時刻:</label>
                    <input type="time" id="inputFluidTime" value="${this.formatTimeForInput(new Date())}">
                </div>
            `;
            
            form.innerHTML = formHTML;
            this.currentInputType = 'fluid';
            document.getElementById('inputFluidVolume').focus();
        }
        
        modal.style.display = 'block';
        this.currentInputConfig = fluidConfig;
    }

    getCurrentVitalValue(vitalName, vitalRecorderData = null) {
        let currentValue = '--';
        
        if (vitalRecorderData && vitalRecorderData.data && this.isVitalRecorderConnected) {
            const backendToVitalMapping = {
                'HR': ['HR', 'PLETH_HR', 'ART_HR'],
                'SpO2': ['SpO2', 'PLETH_SPO2'],
                'sNIBP': ['NIBP_SBP', 'SBP'],
                'dNIBP': ['NIBP_DBP', 'DBP'],
                'sABP': ['ART_SBP'],
                'dABP': ['ART_DBP'],
                'BT': ['TEMP', 'BT'],
                'EtCO2': ['ETCO2', 'CO2'],
                'EtGas': ['ETGAS', 'GAS', 'GAS1_EXPIRED']
            };
            
            const possibleParams = backendToVitalMapping[vitalName] || [];
            
            for (const paramName of possibleParams) {
                if (vitalRecorderData.data[paramName]) {
                    const paramData = vitalRecorderData.data[paramName];
                    if (paramData.value !== null && paramData.value !== undefined) {
                        currentValue = paramData.value;
                        break;
                    }
                }
            }
        } else {
            const vitalToParamName = {
                'HR': 'HR',
                'SpO2': 'SpO2',
                'sNIBP': 'SBP',
                'dNIBP': 'DBP',
                'sABP': 'SBP',
                'dABP': 'DBP',
                'BT': 'TEMP',
                'EtCO2': 'ETCO2',
                'EtGas': 'ETGAS'
            };
            
            const paramName = vitalToParamName[vitalName];
            if (paramName && this.latestVitalValues && this.latestVitalValues[paramName] !== undefined) {
                currentValue = this.latestVitalValues[paramName];
            }
        }
        
        return currentValue;
    }
}

let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new AnesthesiaRecordApp();
});
