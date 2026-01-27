import {App, FileSystemAdapter, Notice, Plugin, TAbstractFile, TFile} from 'obsidian';
import {DEFAULT_SETTINGS, RagFlowSyncPluginSettings, RagFlowSyncPluginSettingTab} from "./settings";
import {createRagflowApi, KnowledgeBaseFile, RagflowApi} from "./ragflowApi";

// Remember to rename these classes and interfaces!

export default class RagFlowSyncPlugin extends Plugin {
	settings: RagFlowSyncPluginSettings;
	private datasetId?: string;

	async onload() {
		await this.loadSettings();

		// Settings tab
		this.addSettingTab(new RagFlowSyncPluginSettingTab(this.app, this));

		// Register file sync after layout is ready to avoid a one-time sync on startup
		this.app.workspace.onLayoutReady(() => {
			const syncHandler = async (file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				if (file.extension.toLowerCase() !== "md") return;
				try {
					await this.syncNote(file);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					this.logError(`Sync failed for ${file.path}`, error);
					new Notice(`Ragflow sync failed: ${message}`);
				}
			};

			this.registerEvent(this.app.vault.on('create', syncHandler));
			this.registerEvent(this.app.vault.on('modify', syncHandler));
		});

	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<RagFlowSyncPluginSettings>);
		this.datasetId = undefined;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.datasetId = undefined;
	}

	private logError(context: string, error: unknown) {
		console.error(`[Ragflow] ${context}`, error);
	}

	private async ensureApi(): Promise<RagflowApi> {
		const {baseUrl, apiKey, vaultName} = this.settings;
		if (!baseUrl?.trim() || !apiKey?.trim() || !vaultName?.trim()) {
			throw new Error("Please configure Ragflow base URL, API key, and vault name in settings");
		}
		return createRagflowApi(this.settings);
	}

	private async ensureDatasetId(): Promise<string> {
		if (this.datasetId) return this.datasetId;
		const api = await this.ensureApi();
		const list = await api.listKnowledgeBases();
		const existing = list.find(kb => kb.name === this.settings.vaultName);
		if (existing?.id) {
			this.datasetId = existing.id;
			return existing.id;
		}
		const created = await api.createKnowledgeBase({name: this.settings.vaultName});
		if (!created?.id) throw new Error("Failed to create Ragflow knowledge base");
		this.datasetId = created.id;
		return created.id;
	}

	private resolveAbsolutePath(file: TFile): string {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getFullPath(file.path);
		}
		throw new Error("Cannot resolve absolute path for this vault adapter");
	}

	private async readFileBinary(file: TFile): Promise<ArrayBuffer> {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.readBinary(file.path);
		}
		throw new Error("Cannot read file data for this vault adapter");
	}

	private buildUploadName(file: TFile): string {
		const parts = file.path.split("/");
		const baseName = parts.pop() ?? file.name;
		const prefix = parts.filter(Boolean).join("-");
		return prefix ? `${prefix}-${baseName}` : baseName;
	}

	private async syncNote(file: TFile): Promise<void> {
		const datasetId = await this.ensureDatasetId();
		const api = await this.ensureApi();
		const relativePath = file.path;
		const uploadName = this.buildUploadName(file);
		const binary = await this.readFileBinary(file);
		const mimeType = file.extension.toLowerCase() === "md" ? "text/markdown" : "application/octet-stream";
		// Remove existing document with the same location or name
		const docs = await api.listFiles(datasetId);
		const existing = docs.find((doc: KnowledgeBaseFile) => doc.location === relativePath || doc.name === uploadName);
		if (existing?.id) {
			await api.deleteFile(datasetId, existing.id);
		}

		console.info(`Uploading data: ${uploadName} , ${mimeType},  ${binary}`);
		await api.uploadFile(datasetId, {fileName: uploadName, data: binary, mimeType});

		new Notice(`Synced to Ragflow: ${relativePath}`);
	}
}
