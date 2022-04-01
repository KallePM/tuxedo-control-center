/*!
 * Copyright (c) 2019-2022 TUXEDO Computers GmbH <tux@tuxedocomputers.com>
 *
 * This file is part of TUXEDO Control Center.
 *
 * TUXEDO Control Center is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * TUXEDO Control Center is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with TUXEDO Control Center.  If not, see <https://www.gnu.org/licenses/>.
 */
import { Injectable, OnDestroy } from '@angular/core';

import { TccPaths } from '../../common/classes/TccPaths';
import { ITccSettings } from '../../common/models/TccSettings';
import { ITccProfile } from '../../common/models/TccProfile';
import { ConfigHandler } from '../../common/classes/ConfigHandler';
import { environment } from '../environments/environment';
import { ElectronService } from 'ngx-electron';
import { Observable, Subject, BehaviorSubject, Subscription } from 'rxjs';
import { UtilsService } from './utils.service';
import { ITccFanProfile } from '../../common/models/TccFanTable';
import { DefaultProfileNames } from '../../common/models/DefaultProfiles';
import { I18n } from '@ngx-translate/i18n-polyfill';
import { TccDBusClientService } from './tcc-dbus-client.service';

interface IProfileTextMappings {
    name: string;
    description: string;
}

@Injectable({
    providedIn: 'root'
})
export class ConfigService implements OnDestroy {

    private config: ConfigHandler;

    private defaultProfiles: ITccProfile[];
    private customProfiles: ITccProfile[];
    private settings: ITccSettings;

    private currentProfileEdit: ITccProfile;
    private currentProfileEditIndex: number;

    public observeSettings: Observable<ITccSettings>;
    private settingsSubject: Subject<ITccSettings>;

    public observeEditingProfile: Observable<ITccProfile>;
    private editingProfileSubject: Subject<ITccProfile>;
    public editingProfile: BehaviorSubject<ITccProfile>;

    private subscriptions: Subscription = new Subscription();

    private defaultProfileInfos = new Map<string, IProfileTextMappings>();

    // Exporting of relevant functions from ConfigHandler
    // public copyConfig = ConfigHandler.prototype.copyConfig;
    // public writeSettings = ConfigHandler.prototype.writeSettings;

    constructor(
        private electron: ElectronService,
        private utils: UtilsService,
        private dbus: TccDBusClientService,
        private i18n: I18n) {
        this.settingsSubject = new Subject<ITccSettings>();
        this.observeSettings = this.settingsSubject.asObservable();

        this.editingProfileSubject = new Subject<ITccProfile>();
        this.observeEditingProfile = this.editingProfileSubject.asObservable();
        this.editingProfile = new BehaviorSubject<ITccProfile>(undefined);

        this.config = new ConfigHandler(
            TccPaths.SETTINGS_FILE,
            TccPaths.PROFILES_FILE,
            TccPaths.AUTOSAVE_FILE,
            TccPaths.FANTABLES_FILE
        );

        this.defaultProfileInfos.set(DefaultProfileNames.MaxEnergySave, {
            name: this.i18n({ value: 'Powersave extreme', id: 'profileNamePowersaveExtreme'}),
            description: this.i18n({ value: 'Lowest possible power consumption and silent fans at the cost of extremely low performance.', id: 'profileDescPowersaveExtreme'})
        });

        this.defaultProfileInfos.set(DefaultProfileNames.Quiet, {
            name: this.i18n({ value: 'Quiet', id: 'profileNameQuiet'}),
            description: this.i18n({ value: 'Low performance for light office tasks for very quiet fans and low power consumption.', id: 'profileDescQuiet'})
        });

        this.defaultProfileInfos.set(DefaultProfileNames.Office, {
            name: this.i18n({ value: 'Office and Multimedia', id: 'profileNameOffice'}),
            description: this.i18n({ value: 'Mid-tier performance for more demanding office tasks or multimedia usage and quiet fans.', id: 'profileDescOffice'})
        });

        this.defaultProfileInfos.set(DefaultProfileNames.HighPerformance, {
            name: this.i18n({ value: 'High Performance', id: 'profileNameHighPerformance'}),
            description: this.i18n({ value: 'High performance for gaming and demanding computing tasks at the cost of moderate to high fan noise and higher temperatures.', id: 'profileDescHighPerformance'})
        });

        this.defaultProfileInfos.set(DefaultProfileNames.MaximumPerformance, {
            name: this.i18n({ value: 'Max Performance', id: 'profileNameMaximumPerformance'}),
            description: this.i18n({ value: 'Maximum performance at the cost of very loud fan noise levels and very high temperatures.', id: 'profileDescMaximumPerformance'})
        });

        this.defaultProfiles = this.dbus.defaultProfiles.value;
        this.updateConfigData();
        this.subscriptions.add(this.dbus.customProfiles.subscribe(nextCustomProfiles => {
            this.customProfiles = nextCustomProfiles;
        }));
        this.subscriptions.add(this.dbus.defaultProfiles.subscribe(nextDefaultProfiles => {
            this.defaultProfiles = nextDefaultProfiles;
        }));
    }

    ngOnDestroy(): void {
        this.subscriptions.unsubscribe();
    }

    public updateConfigData(): void {
        // this.customProfiles = this.config.getCustomProfilesNoThrow();
        this.customProfiles = this.dbus.customProfiles.value;
        /*for (const profile of this.customProfiles) {
            this.utils.fillDefaultValuesProfile(profile);
        }*/
        this.settings = this.config.getSettingsNoThrow();
        this.settingsSubject.next(this.settings);
    }

    public getSettings(): ITccSettings {
        return this.settings;
    }

    get cpuSettingsDisabledMessage(): string {
        return this.i18n({ value: 'CPU settings deactivated in Tools→Global\u00A0Settings' });
    }

    get fanControlDisabledMessage(): string {
        return this.i18n({ value: 'Fan control deactivated in Tools→Global\u00A0Settings' });
    }

    public getCustomProfiles(): ITccProfile[] {
        return this.customProfiles;
    }

    public getDefaultProfiles(): ITccProfile[] {
        return this.defaultProfiles;
    }

    public getAllProfiles(): ITccProfile[] {
        return this.defaultProfiles.concat(this.getCustomProfiles());
    }

    public setActiveProfile(profileName: string, stateId: string): void {
        // Copy existing current settings and set name of new profile
        const newSettings: ITccSettings = this.config.copyConfig<ITccSettings>(this.getSettings());

        newSettings.stateMap[stateId] = profileName;
        const tmpSettingsPath = '/tmp/tmptccsettings';
        this.config.writeSettings(newSettings, tmpSettingsPath);
        let tccdExec: string;

        if (environment.production) {
            tccdExec = TccPaths.TCCD_EXEC_FILE;
        } else {
            tccdExec = this.electron.process.cwd() + '/dist/tuxedo-control-center/data/service/tccd';
        }

        const result = this.electron.ipcRenderer.sendSync(
            'exec-cmd-sync', 'pkexec ' + tccdExec + ' --new_settings ' + tmpSettingsPath
        );
        
        this.updateConfigData();
    }

    public async copyProfile(profileName: string, newProfileName: string) {
        const profileToCopy: ITccProfile = this.getProfileByName(profileName);

        if (profileToCopy === undefined) {
            return false;
        }

        const existingProfile = this.getProfileByName(newProfileName);
        if (existingProfile !== undefined) {
            return false;
        }

        const newProfile: ITccProfile = this.config.copyConfig<ITccProfile>(profileToCopy);
        newProfile.name = newProfileName;
        const newProfileList = this.getCustomProfiles().concat(newProfile);
        const success = await this.pkexecWriteCustomProfilesAsync(newProfileList);
        if (success) {
            this.updateConfigData();
        }
        return success;
    }

    public async deleteCustomProfile(profileNameToDelete: string) {
        const newProfileList: ITccProfile[] = this.getCustomProfiles().filter(profile => profile.name !== profileNameToDelete);
        if (newProfileList.length === this.getCustomProfiles().length) {
            return false;
        }
        const success = await this.pkexecWriteCustomProfilesAsync(newProfileList);
        if (success) {
            this.updateConfigData();
        }
        return success;
    }

    public pkexecWriteCustomProfiles(customProfiles: ITccProfile[]) {
        const tmpProfilesPath = '/tmp/tmptccprofiles';
        this.config.writeProfiles(customProfiles, tmpProfilesPath);
        let tccdExec: string;
        if (environment.production) {
            tccdExec = TccPaths.TCCD_EXEC_FILE;
        } else {
            tccdExec = this.electron.process.cwd() + '/dist/tuxedo-control-center/data/service/tccd';
        }
        const result = this.electron.ipcRenderer.sendSync(
            'exec-cmd-sync', 'pkexec ' + tccdExec + ' --new_profiles ' + tmpProfilesPath
        );
        return result.error === undefined;
    }

    public writeCurrentEditingProfile(): boolean {
        if (this.editProfileChanges()) {
            const changedCustomProfiles: ITccProfile[] = this.config.copyConfig<ITccProfile[]>(this.customProfiles);
            changedCustomProfiles[this.currentProfileEditIndex] = this.getCurrentEditingProfile();

            const result = this.pkexecWriteCustomProfiles(changedCustomProfiles);
            if (result) { this.updateConfigData(); }

            return result;
        } else {
            return false;
        }
    }

    private async pkexecWriteCustomProfilesAsync(customProfiles: ITccProfile[]): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const tmpProfilesPath = '/tmp/tmptccprofiles';
            this.config.writeProfiles(customProfiles, tmpProfilesPath);
            let tccdExec: string;
            if (environment.production) {
                tccdExec = TccPaths.TCCD_EXEC_FILE;
            } else {
                tccdExec = this.electron.process.cwd() + '/dist/tuxedo-control-center/data/service/tccd';
            }
            this.utils.execFile('pkexec ' + tccdExec + ' --new_profiles ' + tmpProfilesPath).then(data => {
                resolve(true);
            }).catch(error => {
                resolve(false);
            });
        });
    }

    public async writeProfile(currentProfileName: string, profile: ITccProfile, states?: string[]): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const profileIndex = this.customProfiles.findIndex(p => p.name === currentProfileName);
            const existingDefaultProfileWithNewName = this.defaultProfiles.findIndex(p => p.name === profile.name);
            const exisitingCustomProfileWithNewName = this.customProfiles.findIndex(p => p.name === profile.name);

            // Copy custom profiles and if provided profile is one of them, overwrite with
            // provided profile
            const customProfilesCopy = this.config.copyConfig<ITccProfile[]>(this.customProfiles);
            const willOverwriteProfile =
                // Is custom profile
                profileIndex !== -1
                // No default profile with same name
                && existingDefaultProfileWithNewName === -1
                // Ensure that a profile with the same name doesn't exist, unless it's the changed one
                && (exisitingCustomProfileWithNewName === -1 || exisitingCustomProfileWithNewName === profileIndex);

            if (willOverwriteProfile) {
                customProfilesCopy[profileIndex] = profile;
            }

            // Copy config and if states are provided, assign the chosen profile to these states
            const newSettings: ITccSettings = this.config.copyConfig<ITccSettings>(this.getSettings());
            if (states !== undefined) {
                for (const stateId of states) {
                    newSettings.stateMap[stateId] = profile.name;
                }
            }

            this.pkexecWriteConfigAsync(newSettings, customProfilesCopy).then(success => {
                if (success) {
                    this.updateConfigData();
                }
                resolve(success);
            });
        });
    }

    public async saveSettings(): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const customProfilesCopy = this.config.copyConfig<ITccProfile[]>(this.customProfiles);
            const newSettings: ITccSettings = this.config.copyConfig<ITccSettings>(this.getSettings());

            this.pkexecWriteConfigAsync(newSettings, customProfilesCopy).then(success => {
                if (success) {
                    this.updateConfigData();
                }
                resolve(success);
            });
        });
    }

    private async pkexecWriteConfigAsync(settings: ITccSettings, customProfiles: ITccProfile[]): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            const tmpProfilesPath = '/tmp/tmptccprofiles';
            const tmpSettingsPath = '/tmp/tmptccsettings';
            this.config.writeProfiles(customProfiles, tmpProfilesPath);
            this.config.writeSettings(settings, tmpSettingsPath);
            let tccdExec: string;
            if (environment.production) {
                tccdExec = TccPaths.TCCD_EXEC_FILE;
            } else {
                tccdExec = this.electron.process.cwd() + '/dist/tuxedo-control-center/data/service/tccd';
            }
            this.utils.execFile(
                'pkexec ' + tccdExec + ' --new_profiles ' + tmpProfilesPath + ' --new_settings ' + tmpSettingsPath
            ).then(data => {
                resolve(true);
            }).catch(error => {
                resolve(false);
            });
        });
    }

    /**
     * Retrieves the currently chosen profile for edit
     *
     * @returns undefined if no profile is set, the profile otherwise
     */
    public getCurrentEditingProfile(): ITccProfile {
        return this.currentProfileEdit;
    }

    public getProfileByName(searchedProfileName: string): ITccProfile {
        const foundProfile: ITccProfile = this.getAllProfiles().find(profile => profile.name === searchedProfileName);
        if (foundProfile !== undefined) {
            return this.config.copyConfig<ITccProfile>(foundProfile);
        } else {
            return undefined;
        }
    }

    public getCustomProfileByName(searchedProfileName: string): ITccProfile {
        const foundProfile: ITccProfile = this.getCustomProfiles().find(profile => profile.name === searchedProfileName);
        if (foundProfile !== undefined) {
            return this.config.copyConfig<ITccProfile>(foundProfile);
        } else {
            return undefined;
        }
    }

    /**
     * Checks if the current edit profile has changes compared to the currently saved
     *
     * @returns true if there are changes, false if there are no changes or no profile
     *          is chosen for edit
     */
    public editProfileChanges(): boolean {
        if (this.currentProfileEdit === undefined) { return false; }
        const currentSavedProfile: ITccProfile = this.customProfiles[this.currentProfileEditIndex];
        // Compare the two profiles
        return JSON.stringify(this.currentProfileEdit) !== JSON.stringify(currentSavedProfile);
    }

    /**
     * Set the current profile to edit. Effectively makes a new copy of the chosen profile
     * for edit and compare with current profile values. Overwrites any current changes.
     *
     * @param customProfileName Profile name used to look up the profile
     * @returns false if the name doesn't exist among the custom profiles, true if successfully set
     */
    public setCurrentEditingProfile(customProfileName: string): boolean {
        if (customProfileName === undefined) {
            this.currentProfileEditIndex = -1;
            this.currentProfileEdit = undefined;
            this.editingProfileSubject.next(undefined);
            this.editingProfile.next(undefined);
        }
        const index = this.currentProfileEditIndex = this.customProfiles.findIndex(e => e.name === customProfileName);
        if (index === -1) {
            return false;
        } else {
            this.currentProfileEditIndex = index;
            this.currentProfileEdit = this.config.copyConfig<ITccProfile>(this.customProfiles[index]);
            this.editingProfileSubject.next(this.currentProfileEdit);
            this.editingProfile.next(this.currentProfileEdit);
            return true;
        }
    }

    public getFanProfiles(): ITccFanProfile[] {
        return this.config.getDefaultFanProfiles();
    }

    public getDefaultProfileName(descriptor: string): string {
        const info = this.defaultProfileInfos.get(descriptor);
        if (info !== undefined) {
            return info.name;
        } else {
            return undefined;
        }
    }

    public getDefaultProfileDescription(descriptor: string): string {
        const info = this.defaultProfileInfos.get(descriptor);
        if (info !== undefined) {
            return info.description;
        } else {
            return undefined;
        }
    }
}
