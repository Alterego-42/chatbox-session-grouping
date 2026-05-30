import * as defaults from '@shared/defaults'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import { type ImageGenerationStorage, IndexedDBImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import { getBrowser, getOS } from '../packages/navigator'
import type { Platform, PlatformType } from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'
import { MobileSQLiteStorage } from './storages'
import WebExporter from './web_exporter'
import webLogger from './web_logger'
import { parseTextFileLocally } from './web_platform_utils'

export default class MobilePlatform extends MobileSQLiteStorage implements Platform {
  public type: PlatformType = 'mobile'

  public exporter = new WebExporter()

  private imageGenerationStorage: ImageGenerationStorage | null = null

  constructor() {
    super()
    webLogger.init().catch((e) => console.error('Failed to init mobile logger:', e))
  }

  public async getVersion(): Promise<string> {
    return 'mobile'
  }
  public async getPlatform(): Promise<string> {
    return 'mobile'
  }
  public async getArch(): Promise<string> {
    return 'mobile'
  }
  public async shouldUseDarkColors(): Promise<boolean> {
    return typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  }
  public onSystemThemeChange(callback: () => void): () => void {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return () => null
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', callback)
    return () => mq.removeEventListener('change', callback)
  }
  public onWindowShow(_callback: () => void): () => void {
    return () => null
  }
  public onWindowFocused(_callback: () => void): () => void {
    return () => null
  }
  public onUpdateDownloaded(_callback: () => void): () => void {
    return () => null
  }
  public async openLink(url: string): Promise<void> {
    if (typeof window !== 'undefined') {
      window.open(url)
    }
  }
  public async getDeviceName(): Promise<string> {
    return getBrowser() ?? 'mobile'
  }
  public async getInstanceName(): Promise<string> {
    return `${getOS()} / ${getBrowser()}`
  }
  public async getLocale() {
    const lang = typeof window !== 'undefined' ? window.navigator.language : 'en'
    return parseLocale(lang)
  }
  public async ensureShortcutConfig(_config: ShortcutSetting): Promise<void> {
    return
  }
  public async ensureProxyConfig(_config: { proxy?: string }): Promise<void> {
    return
  }
  public async relaunch(): Promise<void> {
    if (typeof location !== 'undefined') {
      location.reload()
    }
  }

  public async getConfig(): Promise<Config> {
    let value: Config = await this.getStoreValue('configs')
    if (value === undefined || value === null) {
      value = defaults.newConfigs()
      await this.setStoreValue('configs', value)
    }
    return value
  }
  public async getSettings(): Promise<Settings> {
    let value: Settings = await this.getStoreValue('settings')
    if (value === undefined || value === null) {
      value = defaults.settings()
      await this.setStoreValue('settings', value)
    }
    return value
  }

  public async getStoreBlob(key: string): Promise<string | null> {
    return localforage.getItem<string>(key)
  }
  public async setStoreBlob(key: string, value: string): Promise<void> {
    await localforage.setItem(key, value)
  }
  public async delStoreBlob(key: string) {
    return localforage.removeItem(key)
  }
  public async listStoreBlobKeys(): Promise<string[]> {
    return localforage.keys()
  }

  public initTracking() {
    return
  }
  public trackingEvent(_name: string, _params: { [key: string]: string }) {
    return
  }

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return false
  }

  public async appLog(level: string, message: string): Promise<void> {
    webLogger.log(level, message)
  }

  public async exportLogs(): Promise<string> {
    return webLogger.exportLogs()
  }

  public async clearLogs(): Promise<void> {
    return webLogger.clearLogs()
  }

  public async ensureAutoLaunch(_enable: boolean) {
    return
  }

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    const result = await parseTextFileLocally(file)
    if (!result.isSupported) {
      return { isSupported: false }
    }
    const key = `parseFile-${uuidv4()}`
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
  }

  public async isFullscreen() {
    return true
  }

  public async setFullscreen(_enabled: boolean): Promise<void> {
    return
  }

  installUpdate(): Promise<void> {
    throw new Error('Method not implemented.')
  }

  public getKnowledgeBaseController(): KnowledgeBaseController {
    throw new Error('Method not implemented.')
  }

  public getImageGenerationStorage(): ImageGenerationStorage {
    if (!this.imageGenerationStorage) {
      this.imageGenerationStorage = new IndexedDBImageGenerationStorage()
    }
    return this.imageGenerationStorage
  }

  public minimize() {
    return Promise.resolve()
  }

  public maximize() {
    return Promise.resolve()
  }

  public unmaximize() {
    return Promise.resolve()
  }

  public closeWindow() {
    return Promise.resolve()
  }

  public isMaximized() {
    return Promise.resolve(true)
  }

  public onMaximizedChange() {
    return () => null
  }
}
