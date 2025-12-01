#!/usr/bin/env python3
"""
VitalRecorder Integration Service

This service monitors the VitalDB recording directory for .vital files,
extracts vital sign data using python-vitaldb, and provides a REST API
for the Electron frontend to consume the data.
"""

import os
import glob
import time
import json
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
import logging

import vitaldb
import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class VitalRecorderMonitor:
    def __init__(self, vitaldb_directory: str = "C:/Users/bougt/Downloads/vitaldb"):
        self.vitaldb_directory = vitaldb_directory
        self.current_vital_file = None
        self.vital_data_cache = {}
        self.last_file_check = None
        self.file_age_threshold = 3600  # 1 hour in seconds
        self.data_delay_seconds = 10  # configurable delay
        self.sampling_rate_hz = 1  # configurable sampling rate
        self.monitoring_active = False
        self.available_parameters = []
        self.vitalsigns_config = self.load_vitalsigns_config()

        self.app = Flask(__name__)
        CORS(self.app)
        self.setup_routes()

    def setup_routes(self):
        """Setup Flask API routes"""

        @self.app.route('/api/status', methods=['GET'])
        def get_status():
            """Get current monitoring status"""
            return jsonify({
                'monitoring_active': self.monitoring_active,
                'current_file': self.current_vital_file,
                'last_check': self.last_file_check.isoformat() if self.last_file_check else None,
                'file_age_alert': self.check_file_age_alert(),
                'data_delay_seconds': self.data_delay_seconds,
                'sampling_rate_hz': self.sampling_rate_hz,
                'vitaldb_directory': self.vitaldb_directory
            })

        @self.app.route('/api/config', methods=['POST'])
        def update_config():
            """Update configuration settings"""
            data = request.get_json()
            if 'data_delay_seconds' in data:
                self.data_delay_seconds = int(data['data_delay_seconds'])
            if 'sampling_rate_hz' in data:
                self.sampling_rate_hz = float(data['sampling_rate_hz'])
            if 'vitaldb_directory' in data:
                new_directory = data['vitaldb_directory']
                if new_directory and new_directory.strip():
                    self.vitaldb_directory = new_directory.strip()
                    logger.info(f"VitalDB directory updated to: {self.vitaldb_directory}")
                    self.current_vital_file = None
                    self.available_parameters = []
                    latest_file = self.find_latest_vital_file()
                    if latest_file:
                        self.current_vital_file = latest_file
                        self.load_vital_file_info(latest_file)
                        logger.info(f"Loaded {len(self.available_parameters)} parameters from new directory")
            return jsonify({'success': True, 'vitaldb_directory': self.vitaldb_directory})

        @self.app.route('/api/parameters', methods=['GET'])
        def get_available_parameters():
            """Get available vital sign parameters from current file"""
            try:
                logger.info(f"API request for parameters - current file: {self.current_vital_file}, parameters count: {len(self.available_parameters)}")

                if not self.available_parameters and self.current_vital_file:
                    logger.info("No parameters loaded yet, attempting to load from current file")
                    self.load_vital_file_info(self.current_vital_file)

                response_data = {
                    'parameters': self.available_parameters,
                    'current_file': self.current_vital_file,
                    'status': 'success',
                    'parameter_count': len(self.available_parameters)
                }

                logger.info(f"Returning {len(self.available_parameters)} parameters to frontend")
                return jsonify(response_data)

            except Exception as e:
                logger.error(f"Error in get_available_parameters: {e}")
                return jsonify({
                    'parameters': [],
                    'current_file': None,
                    'status': 'error',
                    'error': str(e),
                    'parameter_count': 0
                }), 500

        @self.app.route('/api/vital-data', methods=['GET'])
        def get_vital_data():
            """Get current vital sign data"""
            if not self.current_vital_file:
                return jsonify({'error': 'No vital file available'}), 404

            try:
                data = self.extract_current_vital_data()
                return jsonify(data)
            except Exception as e:
                logger.error(f"Error extracting vital data: {e}")
                return jsonify({'error': str(e)}), 500

        @self.app.route('/api/start-monitoring', methods=['POST'])
        def start_monitoring():
            """Start file monitoring"""
            self.start_monitoring_thread()
            return jsonify({'success': True, 'monitoring_active': True})

        @self.app.route('/api/stop-monitoring', methods=['POST'])
        def stop_monitoring():
            """Stop file monitoring"""
            self.monitoring_active = False
            return jsonify({'success': True, 'monitoring_active': False})

    def find_latest_vital_file(self) -> Optional[str]:
        """Find the latest .vital file in the directory and subdirectories"""
        try:
            search_path = self.vitaldb_directory.replace('\\', '/')
            pattern = f"{search_path}/**/*.vital"

            if not os.path.exists(search_path):
                search_path = "."
                pattern = f"{search_path}/**/*.vital"

            vital_files = glob.glob(pattern, recursive=True)

            if not vital_files:
                logger.warning(f"No .vital files found in {search_path}")
                return None

            latest_file = max(vital_files, key=os.path.getmtime)
            logger.info(f"Latest vital file: {latest_file}")
            return latest_file

        except Exception as e:
            logger.error(f"Error finding vital files: {e}")
            return None

    def check_file_age_alert(self) -> Dict[str, Any]:
        """Check if the latest file is older than threshold"""
        if not self.current_vital_file:
            return {'alert': True, 'message': 'No vital file found'}

        try:
            file_mtime = os.path.getmtime(self.current_vital_file)
            file_age = time.time() - file_mtime

            if file_age > self.file_age_threshold:
                return {
                    'alert': True,
                    'message': f'Latest vital file is {file_age/60:.1f} minutes old',
                    'file_age_minutes': file_age / 60
                }
            else:
                return {
                    'alert': False,
                    'message': f'File is {file_age/60:.1f} minutes old',
                    'file_age_minutes': file_age / 60
                }

        except Exception as e:
            logger.error(f"Error checking file age: {e}")
            return {'alert': True, 'message': f'Error checking file age: {e}'}

    def load_vital_file_info(self, file_path: str) -> bool:
        """Load vital file and extract available parameters"""
        try:
            if "sample_case.vital" in file_path:
                self.create_mock_parameters()
                return True

            vf = vitaldb.VitalFile(file_path)
            available_tracks = vf.get_track_names()
            logger.info(f"Available tracks ({len(available_tracks)}): {available_tracks}")

            self.available_parameters = []

            for track_name in available_tracks:
                if self.get_parameter_type(track_name) == 'numeric':
                    param_name = track_name.split('/')[-1] if '/' in track_name else track_name

                    track_info = {
                        'name': param_name,
                        'display_name': self.get_parameter_display_name(param_name),
                        'unit': self.get_parameter_unit(param_name),
                        'type': 'numeric',
                        'source_track': track_name
                    }
                    self.available_parameters.append(track_info)
                    logger.info(f"Added parameter {param_name} from track {track_name}")

            logger.info(f"Loaded {len(self.available_parameters)} parameters from {file_path}")
            return True

        except Exception as e:
            logger.error(f"Error loading vital file {file_path}: {e}")
            return False

    def create_mock_parameters(self):
        """Create mock parameters for testing"""
        mock_params = [
            {'name': 'HR', 'display_name': '心拍数', 'unit': 'bpm', 'type': 'numeric'},
            {'name': 'SpO2', 'display_name': '酸素飽和度', 'unit': '%', 'type': 'numeric'},
            {'name': 'SBP', 'display_name': '収縮期血圧', 'unit': 'mmHg', 'type': 'numeric'},
            {'name': 'DBP', 'display_name': '拡張期血圧', 'unit': 'mmHg', 'type': 'numeric'},
            {'name': 'TEMP', 'display_name': '体温', 'unit': '°C', 'type': 'numeric'},
            {'name': 'RR', 'display_name': '呼吸数', 'unit': '/min', 'type': 'numeric'},
            {'name': 'ETCO2', 'display_name': '呼気終末CO2', 'unit': 'mmHg', 'type': 'numeric'}
        ]
        self.available_parameters = mock_params
        logger.info("Created mock parameters for testing")

    def get_parameter_display_name(self, track_name: str) -> str:
        """Get user-friendly display name for parameter"""
        display_names = {
            'HR': '心拍数',
            'PLETH_HR': '心拍数',
            'ECG_HR': '心拍数',
            'SpO2': '酸素飽和度',
            'SPO2': '酸素飽和度',
            'PLETH_SPO2': '酸素飽和度',
            'SBP': '収縮期血圧',
            'DBP': '拡張期血圧',
            'MBP': '平均血圧',
            'NIBP_SBP': '非観血的収縮期血圧',
            'NIBP_DBP': '非観血的拡張期血圧',
            'ART_SBP': '動脈圧収縮期',
            'ART_DBP': '動脈圧拡張期',
            'ART_MBP': '動脈圧平均',
            'CVP': '中心静脈圧',
            'PAP_SBP': '肺動脈圧収縮期',
            'PAP_DBP': '肺動脈圧拡張期',
            'PAP_MBP': '肺動脈圧平均',
            'TEMP': '体温',
            'RR': '呼吸数',
            'RESP_RR': '呼吸数',
            'ETCO2': '呼気終末CO2',
            'FiO2': '吸入酸素濃度',
            'FIO2': '吸入酸素濃度',
            'PEEP': 'PEEP',
            'PIP': '最高気道内圧',
            'Pmean': '平均気道内圧',
            'PMEAN': '平均気道内圧',
            'TV': '一回換気量',
            'MV': '分時換気量'
        }
        return display_names.get(track_name, track_name)

    def get_parameter_unit(self, track_name: str) -> str:
        """Get unit for parameter"""
        units = {
            'HR': 'bpm',
            'PLETH_HR': 'bpm',
            'ECG_HR': 'bpm',
            'SpO2': '%',
            'SPO2': '%',
            'PLETH_SPO2': '%',
            'SBP': 'mmHg',
            'DBP': 'mmHg',
            'MBP': 'mmHg',
            'NIBP_SBP': 'mmHg',
            'NIBP_DBP': 'mmHg',
            'ART_SBP': 'mmHg',
            'ART_DBP': 'mmHg',
            'ART_MBP': 'mmHg',
            'CVP': 'mmHg',
            'PAP_SBP': 'mmHg',
            'PAP_DBP': 'mmHg',
            'PAP_MBP': 'mmHg',
            'TEMP': '°C',
            'RR': '/min',
            'RESP_RR': '/min',
            'ETCO2': 'mmHg',
            'FiO2': '%',
            'FIO2': '%',
            'PEEP': 'cmH2O',
            'PIP': 'cmH2O',
            'Pmean': 'cmH2O',
            'PMEAN': 'cmH2O',
            'TV': 'mL',
            'MV': 'L/min'
        }
        return units.get(track_name, '')

    def get_parameter_type(self, track_name: str) -> str:
        """Get parameter type (waveform or numeric)"""
        numeric_suffixes = ['HR', 'SBP', 'DBP', 'MBP', 'SPO2', 'TEMP', 'RR', 'ETCO2',
                           'FIO2', 'PEEP', 'PIP', 'PMEAN', 'TV', 'MV', 'NIBP_SBP', 'NIBP_DBP',
                           'ART_SBP', 'ART_DBP', 'ART_MBP', 'CVP', 'PAP_SBP', 'PAP_DBP', 'PAP_MBP',
                           'PLETH_HR', 'PLETH_SPO2', 'ECG_HR', 'RESP_RR']

        track_upper = track_name.upper()
        for suffix in numeric_suffixes:
            if track_upper.endswith(suffix):
                return 'numeric'

        waveform_only_params = ['ECG', 'PLETH', 'RESP', 'CO2', 'FLOW', 'PRES']
        for wave_param in waveform_only_params:
            if wave_param in track_upper and not any(track_upper.endswith(suffix) for suffix in numeric_suffixes):
                return 'waveform'

        return 'numeric'
    def format_vital_value(self, param_name: str, raw_value: float, decimals = None):
        """Format vital values according to VitalRecorder display standards"""
        if decimals is not None:
            if decimals == 0:
                return int(round(raw_value))
            else:
                return round(raw_value, decimals)

        param_mapping = {
            'HR': 'HR', 'PLETH_HR': 'HR', 'ECG_HR': 'HR',
            'SpO2': 'SpO2', 'SPO2': 'SpO2', 'PLETH_SPO2': 'SpO2',
            'SBP': 'sNIBP', 'NIBP_SBP': 'sNIBP', 'ART_SBP': 'sABP',
            'DBP': 'dNIBP', 'NIBP_DBP': 'dNIBP', 'ART_DBP': 'dABP',
            'TEMP': 'BT', 'BT': 'BT',
            'RR': 'RR', 'RESP_RR': 'RR',
            'ETCO2': 'EtCO2', 'CO2': 'EtCO2',
            'GAS1_EXPIRED': 'EtGas'
        }

        mapped_param = param_mapping.get(param_name, param_name)
        if mapped_param in self.vitalsigns_config:
            config_decimals = self.vitalsigns_config[mapped_param]['decimals']
            if config_decimals == 0:
                return int(round(raw_value))
            else:
                return round(raw_value, config_decimals)

        integer_params = ['HR', 'SBP', 'DBP', 'RR', 'ETCO2']
        one_decimal_params = ['TEMP']

        if param_name in integer_params:
            return int(round(raw_value))
        elif param_name in one_decimal_params:
            return round(raw_value, 1)
        else:
            return int(round(raw_value))


    def extract_current_vital_data(self) -> Dict[str, Any]:
        """Extract vital sign data from current time - delay"""
        if not self.current_vital_file:
            raise Exception("No vital file available")

        try:
            if "sample_case.vital" in self.current_vital_file:
                logger.warning("Sample case file detected - no real data available")
                return {
                    'timestamp': datetime.now().isoformat(),
                    'data': {},
                    'status': 'sample_file_no_data'
                }

            vf = vitaldb.VitalFile(self.current_vital_file)

            available_tracks = vf.get_track_names()
            logger.info(f"Available tracks ({len(available_tracks)}): {available_tracks[:20]}...")
            vital_data = {}

            for param_info in self.available_parameters:
                param_name = param_info['name']
                source_track = param_info['source_track']

                if source_track in available_tracks:
                    try:
                        data = vf.to_numpy([source_track], 1.0)
                        if data is not None and len(data) > 0:
                            track_values = data[:, 0]
                            valid_indices = ~np.isnan(track_values)
                            valid_values = track_values[valid_indices]

                            if len(valid_values) > 0:
                                last_value = float(valid_values[-1])  # Convert numpy float32 to Python float

                                formatted_value = self.format_vital_value(param_name, last_value)

                                vital_data[param_name] = {
                                    'value': formatted_value,
                                    'timestamp': float(time.time() - self.data_delay_seconds),  # Ensure timestamp is Python float
                                    'unit': param_info['unit'],
                                    'display_name': param_info['display_name']
                                }
                                logger.info(f"Extracted {param_name}: {last_value} -> {formatted_value} from track {source_track}")
                            else:
                                logger.warning(f"No valid values found for {param_name} in track {source_track}")
                        else:
                            logger.warning(f"No data returned for {param_name} from track {source_track}")

                    except Exception as e:
                        logger.warning(f"Error extracting data for {param_name} from {source_track}: {e}")
                        continue
                else:
                    logger.warning(f"Track {source_track} not found for parameter {param_name}")

            if len(vital_data) == 0:
                logger.warning("No vital data extracted from VitalDB file")
                return {
                    'timestamp': datetime.now().isoformat(),
                    'data': {},
                    'status': 'no_data_available'
                }

            return {
                'timestamp': datetime.now().isoformat(),
                'file': self.current_vital_file,
                'data': vital_data
            }

        except Exception as e:
            logger.error(f"Error extracting vital data: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                'timestamp': datetime.now().isoformat(),
                'data': {},
                'status': 'extraction_error'
            }

    def generate_mock_vital_data(self) -> Dict[str, Any]:
        """Generate mock vital data for testing - DEPRECATED: Should not be used with real VitalDB data"""
        logger.warning("generate_mock_vital_data called - this should not be used with real VitalDB integration")
        return {
            'timestamp': datetime.now().isoformat(),
            'data': {},
            'status': 'no_mock_data'
        }

    def sample_waveform_data(self, data: np.ndarray, target_rate: float) -> Optional[np.ndarray]:
        """Sample waveform data to target rate"""
        if data is None or len(data) == 0:
            return None

        try:
            original_rate = len(data)  # Assume 1 second of data
            if original_rate <= target_rate:
                return data

            step = int(original_rate / target_rate)
            return data[::step]

        except Exception as e:
            logger.error(f"Error sampling waveform data: {e}")
            return None

    def monitoring_loop(self):
        """Main monitoring loop"""
        logger.info("Starting vital file monitoring loop")

        while self.monitoring_active:
            try:
                latest_file = self.find_latest_vital_file()

                if latest_file != self.current_vital_file:
                    logger.info(f"New vital file detected: {latest_file}")
                    self.current_vital_file = latest_file

                    if latest_file:
                        self.load_vital_file_info(latest_file)

                self.last_file_check = datetime.now()

                time.sleep(5)  # Check every 5 seconds

            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                time.sleep(10)  # Wait longer on error

    def start_monitoring_thread(self):
        """Start monitoring in a separate thread"""
        if not self.monitoring_active:
            self.monitoring_active = True
            monitor_thread = threading.Thread(target=self.monitoring_loop, daemon=True)
            monitor_thread.start()
            logger.info("Monitoring thread started")

    def run(self, host='127.0.0.1', port=5002, debug=False):
        """Run the Flask application"""
        logger.info(f"Starting VitalRecorder service on {host}:{port}")

        try:
            latest_file = self.find_latest_vital_file()
            if latest_file:
                logger.info(f"Loading initial vital file: {latest_file}")
                self.current_vital_file = latest_file
                self.load_vital_file_info(latest_file)
                logger.info(f"Loaded {len(self.available_parameters)} parameters on startup")
            else:
                logger.warning("No vital files found on startup")
        except Exception as e:
            logger.error(f"Error during initial file loading: {e}")

        self.app.run(host=host, port=port, debug=debug, threaded=True, use_reloader=False)

    def load_vitalsigns_config(self):
        """Load vitalsigns.csv configuration for decimal formatting"""
        try:
            import csv
            import os

            config_path = os.path.join(os.path.dirname(__file__), 'config', 'vitalsigns.csv')
            vitalsigns_config = {}

            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8-sig') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        vitalsigns_config[row['name']] = {
                            'decimals': int(row.get('decimals', 0)),
                            'symbol': row.get('symbol', ''),
                            'color': row.get('color', ''),
                            'range': row.get('range', '')
                        }

            logger.info(f"Loaded vitalsigns config: {vitalsigns_config}")
            return vitalsigns_config

        except Exception as e:
            logger.error(f"Error loading vitalsigns config: {e}")
            return {}

if __name__ == '__main__':
    monitor = VitalRecorderMonitor()

    logger.info("Initializing VitalRecorder service...")

    try:
        latest_file = monitor.find_latest_vital_file()
        if latest_file:
            logger.info(f"Found initial vital file: {latest_file}")
            monitor.current_vital_file = latest_file
            monitor.load_vital_file_info(latest_file)
            logger.info(f"Pre-loaded {len(monitor.available_parameters)} parameters")

        monitor.start_monitoring_thread()
        logger.info("Service initialization complete, starting Flask server...")

        monitor.run(port=5002, debug=False)

    except KeyboardInterrupt:
        logger.info("Service stopped by user")
        monitor.monitoring_active = False
    except Exception as e:
        logger.error(f"Service startup error: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
