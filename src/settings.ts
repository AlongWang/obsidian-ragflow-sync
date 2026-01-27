import { App, ButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import RagFlowSyncPlugin from "./main";
import { createRagflowApi } from "./ragflowApi";

export interface RagFlowSyncPluginSettings {
	baseUrl: string;
	apiKey: string;
	vaultName: string;
}

export const DEFAULT_SETTINGS: RagFlowSyncPluginSettings = {
	baseUrl: '',
	apiKey: '',
	vaultName: ''
}

export class RagFlowSyncPluginSettingTab extends PluginSettingTab {
	plugin: RagFlowSyncPlugin;

	constructor(app: App, plugin: RagFlowSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		let validateButton: ButtonComponent | undefined;
		let dirty = false;
		const refreshValidateButton = () => {
			const hasRequired = Boolean(this.plugin.settings.baseUrl.trim() && this.plugin.settings.apiKey.trim() && this.plugin.settings.vaultName.trim());
			validateButton?.setDisabled(!(hasRequired && !dirty));
		};

		containerEl.empty();

		const ragflowSettingRow = new Setting(containerEl)
			.setName('Ragflow Settings').setHeading();

		new Setting(containerEl)
			.setName('Ragflow base URL (required)')
			.setDesc('Base endpoint for the Ragflow service, e.g. https://your-ragflow-host')
			.addText(text => text
				.setPlaceholder('https://your-ragflow-host')
				.setValue(this.plugin.settings.baseUrl)
				.onChange(async (value) => {
					this.plugin.settings.baseUrl = value;
					dirty = true;
					refreshValidateButton();
				}));

		new Setting(containerEl)
			.setName('API key (required)')
			.setDesc('API key used to authenticate with Ragflow')
			.addText(text => {
				text.inputEl.type = "password"; // SecretComponent-style: mask input to keep API key private in UI
				text
					.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						dirty = true;
						refreshValidateButton();
					});
			});

		new Setting(containerEl)
			.setName('Vault name')
			.setDesc('Optional identifier for the Obsidian vault to send to Ragflow')
			.addText(text => text
				.setPlaceholder('My Vault')
				.setValue(this.plugin.settings.vaultName)
				.onChange(async (value) => {
					this.plugin.settings.vaultName = value;
					dirty = true;
					refreshValidateButton();
				}));

		const buttonRow = new Setting(containerEl);
		buttonRow.addButton(button => button
			.setButtonText('Save settings')
			.setCta()
			.onClick(async () => {
				const baseUrl = this.plugin.settings.baseUrl.trim();
				const apiKey = this.plugin.settings.apiKey.trim();
				const vaultName = this.plugin.settings.vaultName.trim();

				if (!baseUrl) {
					new Notice('Ragflow base URL is required');
					return;
				}

				if (!apiKey) {
					new Notice('API key is required');
					return;
				}

				if (!vaultName) {
					new Notice('Vault name is required');
					return;
				}

				this.plugin.settings.baseUrl = baseUrl;
				this.plugin.settings.apiKey = apiKey;
				this.plugin.settings.vaultName = vaultName;
				await this.plugin.saveSettings();
				dirty = false;
				new Notice('Settings saved');
				refreshValidateButton();
			}));

		buttonRow.addButton(button => {
			validateButton = button;
			button.setButtonText('Validate settings')
				.onClick(async () => {
					const baseUrl = this.plugin.settings.baseUrl.trim();
					const apiKey = this.plugin.settings.apiKey.trim();
					const vaultName = this.plugin.settings.vaultName.trim();

					if (!baseUrl || !apiKey || !vaultName) {
						new Notice('Please save URL, API key, and vault name first');
						return;
					}

					button.setDisabled(true);
					button.setButtonText('Validating...');

					try {
						const api = createRagflowApi({
							baseUrl,
							apiKey,
							vaultName
						});

						const knowledgeBases = await api.listKnowledgeBases();
						const existing = knowledgeBases.find(kb => kb.name === vaultName);

						if (!existing) {
							await api.createKnowledgeBase({ name: vaultName });
						}

						new Notice('Validation succeeded');
					} catch (error) {
						const message = error instanceof Error ? error.message : 'Unknown validation error';
						new Notice(`Validation failed: ${message}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText('Validate settings');
						refreshValidateButton();
					}
				});
		});

		refreshValidateButton();
	}
}
