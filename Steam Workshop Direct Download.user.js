// ==UserScript==
// @name         Steam Workshop Direct Download
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Link direto modular com suporte a múltiplos jogos, i18n, fallback de banco de dados.
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/filedetails/?id=*
// @match        https://steamcommunity.com/workshop/browse/*
// @match        https://steamcommunity.com/app/*/workshop/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      raw.githubusercontent.com
// @connect      insane.x10.mx
// @connect      api.steampowered.com
// @connect      catalogue.smods.ru
// @updateURL    https://github.com/Martin01683/Scripts-do-ViolentMonkey/raw/refs/heads/main/Steam%20Workshop%20Direct%20Download.user.js
// @downloadURL  https://github.com/Martin01683/Scripts-do-ViolentMonkey/raw/refs/heads/main/Steam%20Workshop%20Direct%20Download.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ========================================================================
    // 1. CONFIGURAÇÃO DE JOGOS E BANCOS DE DADOS (MODULARIDADE)
    // ========================================================================
    
    const utils = {
        extractJsonArray: function(text, varName) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return text;
                if (parsed[varName]) return JSON.stringify(parsed[varName]);
            } catch (e) {}
            const regex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\[`);
            const match = text.match(regex);
            if (!match) return null;
            const startIdx = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = startIdx; i < text.length; i++) {
                if (text[i] === '[') depth++;
                else if (text[i] === ']') {
                    depth--;
                    if (depth === 0) return text.substring(startIdx, i + 1);
                }
            }
            return null;
        },
        parseInsaneDate: function(dateStr) {
            if (!dateStr || dateStr.startsWith('0000-00-00')) return null;
            const d = new Date(dateStr.replace(' ', 'T') + '+01:00');
            return isNaN(d.getTime()) ? null : d;
        },
        parseGithubDate: function(dateStr) {
            if (!dateStr) return null;
            const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
            if (!match) return null;
            return new Date(Date.UTC(match[1], match[2] - 1, match[3], match[4] - 1, match[5], match[6] || 0));
        },
        parseSmodsDate: function(dateStr) {
            if (!dateStr) return null;
            let normalized = dateStr.replace(/ at /i, ' ').trim();
            if (!/\d{4}/.test(normalized)) {
                const currentYear = new Date().getFullYear();
                normalized = normalized.replace(/\b(\d{1,2}:\d{2})\b/, `${currentYear} $1`);
            }
            const d = new Date(normalized + " -03:00");
            return isNaN(d.getTime()) ? null : d;
        },
        getIdFromName: function(name) {
            const match = String(name || '').match(/^\s*(\d{6,})/);
            return match ? match[1] : null;
        },
        isUpToDate: function(dateMirror, dateSteam) {
            if (dateSteam === STEAM_NO_DATE || dateSteam === STEAM_FETCH_ERROR) return true;
            if (!dateMirror) return false;
            // Corta os milissegundos e segundos para evitar "falso-desatualizado"
            // (já que o site de mirror às vezes não fornece os segundos exatos de upload)
            const minMirror = Math.floor(dateMirror.getTime() / 60000);
            const minSteam = Math.floor(dateSteam.getTime() / 60000);
            return minMirror >= minSteam;
        }
    };

    const GAMES_CONFIG = {
        '1118520': {
            name: "Paralives",
            forumUrl: "https://cs.rin.ru/forum/viewtopic.php?f=10&t=158692",
            databases: [
                {
                    id: "github_main",
                    name: "GitHub",
                    type: "full_db",
                    url: "https://raw.githubusercontent.com/AORUS834/947e26abefdb9eb0a9cd292d2ee691d9/refs/heads/main/files.json",
                    cacheTime: 10 * 60 * 1000,
                    parser: (responseText) => {
                        const json = JSON.parse(responseText);
                        const files = Array.isArray(json?.files) ? json.files : [];
                        const result = {};
                        files.forEach(file => {
                            const idSteam = utils.getIdFromName(file?.name);
                            const link = file?.link || file?.url;
                            if (idSteam && link) result[idSteam] = { link: link, date: utils.parseGithubDate(file.uploaded) };
                        });
                        return result;
                    }
                },
                {
                    id: "insane_php",
                    name: "Insane DB",
                    type: "full_db",
                    url: "https://insane.x10.mx/paralives.php",
                    cacheTime: 60 * 60 * 1000,
                    parser: (responseText) => {
                        const jsonString = utils.extractJsonArray(responseText, 'allMods');
                        if (!jsonString) throw new Error("Format error");
                        const parsedData = JSON.parse(jsonString);
                        const result = {};
                        parsedData.forEach(mod => {
                            if (mod.name && (mod.link || mod.url)) {
                                const idSteam = mod.name.match(/^(\d+)/);
                                if (idSteam) result[idSteam[1]] = { link: mod.link || mod.url, date: utils.parseInsaneDate(mod.uploaded) };
                            }
                        });
                        return result;
                    }
                },
                {
                    id: "smods_ru",
                    name: "Skymods",
                    type: "per_mod",
                    url: (modId) => `https://catalogue.smods.ru/?s=${modId}&app=1118520`,
                    cacheTime: 60 * 60 * 1000,
                    parser: (responseText, modId) => {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(responseText, "text/html");
                        
                        let bestMatch = null;
                        const posts = doc.querySelectorAll('.post-list article');
                        
                        for (const post of posts) {
                            const dateStrEl = post.querySelector('.skymods-item-date');
                            // Busca o botão de download que joga para fora do site
                            const linkEl = Array.from(post.querySelectorAll('.skymods-excerpt-btn')).find(a => a.href && !a.href.includes('/archives/'));
                            
                            if (dateStrEl && linkEl) {
                                const modData = { 
                                    link: linkEl.href, 
                                    date: utils.parseSmodsDate(dateStrEl.textContent) 
                                };
                                
                                // Verifica se esse resultado da busca bate exatamente com a página original da Steam do nosso mod
                                const steamLink = post.querySelector('a[href*="steamcommunity.com/"][href*="?id="]');
                                if (steamLink && steamLink.href.includes(modId)) {
                                    return modData; // Correspondência exata encontrada
                                }
                                
                                if (!bestMatch) bestMatch = modData; // Salva o primeiro como fallback se nenhum link bater
                            }
                        }
                        return bestMatch;
                    }
                }
            ]
        },
        '3450310': {
            name: "Europa Universalis V",
            forumUrl: "https://cs.rin.ru/forum/viewtopic.php?f=10&t=152865",
            databases: [
                {
                    id: "insane_php_eu5",
                    name: "Insane DB (EU5)",
                    type: "full_db",
                    url: "https://insane.x10.mx/eu5.php",
                    cacheTime: 60 * 60 * 1000,
                    parser: (responseText) => {
                        const jsonString = utils.extractJsonArray(responseText, 'allMods');
                        if (!jsonString) throw new Error("Format error");
                        const parsedData = JSON.parse(jsonString);
                        const result = {};
                        parsedData.forEach(mod => {
                            if (mod.name && (mod.link || mod.url)) {
                                const idSteam = mod.name.match(/^(\d+)/);
                                if (idSteam) result[idSteam[1]] = { link: mod.link || mod.url, date: utils.parseInsaneDate(mod.uploaded) };
                            }
                        });
                        return result;
                    }
                }
            ]
        }
    };

    function getAppId() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('appid')) return urlParams.get('appid');
        const pathMatch = window.location.pathname.match(/\/app\/(\d+)/);
        if (pathMatch) return pathMatch[1];
        const input = document.querySelector('input[name="appid"]');
        if (input && input.value) return input.value;
        const breadcrumb = document.querySelector('.breadcrumbs a[href*="/app/"]');
        if (breadcrumb) {
            const bMatch = breadcrumb.href.match(/\/app\/(\d+)/);
            if (bMatch) return bMatch[1];
        }
        return null;
    }

    const currentAppId = getAppId();
    if (!currentAppId || !GAMES_CONFIG[currentAppId]) return;
    const GAME = GAMES_CONFIG[currentAppId];

    const CACHE_PREFIX = `SWDD_${currentAppId}_`;
    const CACHE_TIME_STEAM_MS = 10 * 60 * 1000;
    const STEAM_NO_DATE = 'NO_DATE';
    const STEAM_FETCH_ERROR = 'FETCH_ERROR';
    const STEAM_CACHE_KEY = `${CACHE_PREFIX}Steam`;

    // ========================================================================
    // 2. TRADUÇÕES (I18N)
    // ========================================================================
    const translations = {
        en: { loading: '⏳ Loading...', checkingVersion: '⏳ Checking Version...', dbError: '⚠️ Mirror DB Error', requestMod: '➕ Request Mod', modNotListed: 'Mod not listed. Click to request.', download: '✅ Download', downloadWarning: '⚠️ Download', modUpdated: 'MOD UP TO DATE', modOutdated: 'MOD OUTDATED', requestUpdate: 'Request Update on Forum', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Cache Status:', cacheSteam: 'Steam:', cacheDB: 'Database:', justNow: 'just now', minAgo: 'min ago', steamError: '⚠️ Unverified', steamErrorTip: 'Steam API unreachable. Version not verified.', mirrorNoDate: '⚠️ Unverified Mirror', mirrorNoDateTip: 'Could not verify mirror version date.', updateCache: '🔄 Update Cache', cacheCooldown: '⏳ Update cache ({s}s)', idlePaused: '⏸️ Paused (Idle)', idleActive: '🟢 Active' },
        pt: { loading: '⏳ Buscando...', checkingVersion: '⏳ Verificando versão...', dbError: '⚠️ Erro na Base', requestMod: '➕ Pedir Mod', modNotListed: 'Mod não listado. Clique para pedir.', download: '✅ Baixar', downloadWarning: '⚠️ Baixar', modUpdated: 'MOD ATUALIZADO', modOutdated: 'MOD DESATUALIZADO', requestUpdate: 'Pedir Atualização no Fórum', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Status do Cache:', cacheSteam: 'Steam:', cacheDB: 'Banco de Dados:', justNow: 'agora', minAgo: 'min atrás', steamError: '⚠️ Sem Verificar', steamErrorTip: 'Falha na API Steam. Versão não verificada.', mirrorNoDate: '⚠️ Mirror sem data', mirrorNoDateTip: 'Não foi possível verificar a versão do mirror.', updateCache: '🔄 Atualizar Cache', cacheCooldown: '⏳ Atualizar cache ({s}s)', idlePaused: '⏸️ Pausado (Inativo)', idleActive: '🟢 Ativo' },
        es: { loading: '⏳ Buscando...', checkingVersion: '⏳ Comprobando versión...', dbError: '⚠️ Error de base', requestMod: '➕ Pedir mod', modNotListed: 'Mod no listado. Haz clic para pedirlo.', download: '✅ Descargar', downloadWarning: '⚠️ Descargar', modUpdated: 'MOD ACTUALIZADO', modOutdated: 'MOD DESACTUALIZADO', requestUpdate: 'Pedir actualización en el foro', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Estado del caché:', cacheSteam: 'Steam:', cacheDB: 'Base de datos:', justNow: 'ahora', minAgo: 'min atrás', steamError: '⚠️ No verificado', steamErrorTip: 'Fallo en la API de Steam. Versión no verificada.', mirrorNoDate: '⚠️ Mirror sin fecha', mirrorNoDateTip: 'No se pudo verificar la versión del mirror.', updateCache: '🔄 Actualizar caché', cacheCooldown: '⏳ Actualizar caché ({s}s)', idlePaused: '⏸️ Pausado (Inactivo)', idleActive: '🟢 Activo' },
        fr: { loading: '⏳ Recherche...', checkingVersion: '⏳ Vérification de la version...', dbError: '⚠️ Erreur de base', requestMod: '➕ Demander le mod', modNotListed: 'Mod non listé. Cliquez pour le demander.', download: '✅ Télécharger', downloadWarning: '⚠️ Télécharger', modUpdated: 'MOD À JOUR', modOutdated: 'MOD OBSOLÈTE', requestUpdate: 'Demander une mise à jour sur le forum', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'État du cache:', cacheSteam: 'Steam:', cacheDB: 'Base de données:', justNow: 'à l\'instant', minAgo: 'min', steamError: '⚠️ Non vérifié', steamErrorTip: 'Erreur de l\'API Steam. Version non vérifiée.', mirrorNoDate: '⚠️ Mirror sans date', mirrorNoDateTip: 'Impossible de vérifier la version du mirror.', updateCache: '🔄 Mettre à jour le cache', cacheCooldown: '⏳ Mettre à jour ({s}s)', idlePaused: '⏸️ En pause (Inactif)', idleActive: '🟢 Actif' },
        de: { loading: '⏳ Suche...', checkingVersion: '⏳ Version wird geprüft...', dbError: '⚠️ Datenbankfehler', requestMod: '➕ Mod anfragen', modNotListed: 'Mod nicht gelistet. Zum Anfragen klicken.', download: '✅ Herunterladen', downloadWarning: '⚠️ Herunterladen', modUpdated: 'MOD AKTUELL', modOutdated: 'MOD VERALTET', requestUpdate: 'Update im Forum anfragen', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Cache-Status:', cacheSteam: 'Steam:', cacheDB: 'Datenbank:', justNow: 'gerade eben', minAgo: 'Min. her', steamError: '⚠️ Nicht verifiziert', steamErrorTip: 'Steam API nicht erreichbar. Version nicht verifiziert.', mirrorNoDate: '⚠️ Mirror ohne Datum', mirrorNoDateTip: 'Mirror-Version konnte nicht verifiziert werden.', updateCache: '🔄 Cache aktualisieren', cacheCooldown: '⏳ Cache aktualisieren ({s}s)', idlePaused: '⏸️ Pausiert (Inaktiv)', idleActive: '🟢 Aktiv' },
        it: { loading: '⏳ Ricerca...', checkingVersion: '⏳ Controllo versione...', dbError: '⚠️ Errore database', requestMod: '➕ Richiedi mod', modNotListed: 'Mod non presente. Clicca per richiederla.', download: '✅ Scarica', downloadWarning: '⚠️ Scarica', modUpdated: 'MOD AGGIORNATA', modOutdated: 'MOD NON AGGIORNATA', requestUpdate: 'Richiedi aggiornamento sul forum', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Stato cache:', cacheSteam: 'Steam:', cacheDB: 'Database:', justNow: 'adesso', minAgo: 'min fa', steamError: '⚠️ Non verificato', steamErrorTip: 'API Steam non raggiungibile. Versione non verificata.', mirrorNoDate: '⚠️ Mirror senza data', mirrorNoDateTip: 'Impossibile verificare la versione del mirror.', updateCache: '🔄 Aggiorna cache', cacheCooldown: '⏳ Aggiorna cache ({s}s)', idlePaused: '⏸️ In pausa (Inattivo)', idleActive: '🟢 Attivo' },
        nl: { loading: '⏳ Zoeken...', checkingVersion: '⏳ Versie controleren...', dbError: '⚠️ Databasefout', requestMod: '➕ Mod aanvragen', modNotListed: 'Mod staat niet in de lijst. Klik om aan te vragen.', download: '✅ Downloaden', downloadWarning: '⚠️ Downloaden', modUpdated: 'MOD IS UP-TO-DATE', modOutdated: 'MOD IS VEROUDERD', requestUpdate: 'Update aanvragen op het forum', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Cache-status:', cacheSteam: 'Steam:', cacheDB: 'Database:', justNow: 'zojuist', minAgo: 'min geleden', steamError: '⚠️ Ongecontroleerd', steamErrorTip: 'Steam API onbereikbaar. Versie niet gecontroleerd.', mirrorNoDate: '⚠️ Mirror zonder datum', mirrorNoDateTip: 'Kon de mirrorversie niet verifiëren.', updateCache: '🔄 Cache bijwerken', cacheCooldown: '⏳ Cache bijwerken ({s}s)', idlePaused: '⏸️ Gepauzeerd (Inactief)', idleActive: '🟢 Actief' },
        pl: { loading: '⏳ Szukanie...', checkingVersion: '⏳ Sprawdzanie wersji...', dbError: '⚠️ Błąd bazy', requestMod: '➕ Poproś o mod', modNotListed: 'Mod nie jest na liście. Kliknij, aby poprosić.', download: '✅ Pobierz', downloadWarning: '⚠️ Pobierz', modUpdated: 'MOD AKTUALNY', modOutdated: 'MOD NIEAKTUALNY', requestUpdate: 'Poproś o aktualizację na forum', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Stan pamięci podręcznej:', cacheSteam: 'Steam:', cacheDB: 'Baza danych:', justNow: 'właśnie teraz', minAgo: 'min temu', steamError: '⚠️ Niezweryfikowane', steamErrorTip: 'API Steam niedostępne. Wersja niezweryfikowana.', mirrorNoDate: '⚠️ Mirror bez daty', mirrorNoDateTip: 'Nie można zweryfikować wersji mirrora.', updateCache: '🔄 Zaktualizuj pamięć', cacheCooldown: '⏳ Zaktualizuj pamięć ({s}s)', idlePaused: '⏸️ Wstrzymano (Bezczynny)', idleActive: '🟢 Aktywny' },
        ru: { loading: '⏳ Поиск...', checkingVersion: '⏳ Проверка версии...', dbError: '⚠️ Ошибка базы', requestMod: '➕ Запросить мод', modNotListed: 'Мода нет в списке. Нажмите, чтобы запросить.', download: '✅ Скачать', downloadWarning: '⚠️ Скачать', modUpdated: 'МОД АКТУАЛЕН', modOutdated: 'МОД УСТАРЕЛ', requestUpdate: 'Запросить обновление на форуме', labelSteam: 'Steam:', labelInsane: 'Зеркало:', labelCache: 'Статус кэша:', cacheSteam: 'Steam:', cacheDB: 'База данных:', justNow: 'только что', minAgo: 'мин назад', steamError: '⚠️ Не проверено', steamErrorTip: 'API Steam недоступен. Версия не проверена.', mirrorNoDate: '⚠️ Зеркало без даты', mirrorNoDateTip: 'Не удалось проверить версию зеркала.', updateCache: '🔄 Обновить кэш', cacheCooldown: '⏳ Обновить кэш ({s}s)', idlePaused: '⏸️ Пауза (Бездействие)', idleActive: '🟢 Активно' },
        tr: { loading: '⏳ Aranıyor...', checkingVersion: '⏳ Sürüm kontrol ediliyor...', dbError: '⚠️ Veritabanı hatası', requestMod: '➕ Mod iste', modNotListed: 'Mod listede yok. İstemek için tıkla.', download: '✅ İndir', downloadWarning: '⚠️ İndir', modUpdated: 'MOD GÜNCEL', modOutdated: 'MOD ESKİ', requestUpdate: 'Forumda güncelleme iste', labelSteam: 'Steam:', labelInsane: 'Mirror:', labelCache: 'Önbellek Durumu:', cacheSteam: 'Steam:', cacheDB: 'Veritabanı:', justNow: 'şimdi', minAgo: 'dk önce', steamError: '⚠️ Doğrulanmadı', steamErrorTip: 'Steam API\'sine ulaşılamıyor. Sürüm doğrulanmadı.', mirrorNoDate: '⚠️ Tarihsiz Mirror', mirrorNoDateTip: 'Mirror sürümü doğrulanamadı.', updateCache: '🔄 Önbelleği Güncelle', cacheCooldown: '⏳ Önbelleği güncelle ({s}s)', idlePaused: '⏸️ Duraklatıldı (Boşta)', idleActive: '🟢 Aktif' },
        zh: { loading: '⏳ 正在查找...', checkingVersion: '⏳ 正在检查版本...', dbError: '⚠️ 数据库错误', requestMod: '➕ 请求 Mod', modNotListed: 'Mod 未收录。点击请求。', download: '✅ 下载', downloadWarning: '⚠️ 下载', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已过期', requestUpdate: '在论坛请求更新', labelSteam: 'Steam:', labelInsane: '镜像:', labelCache: '缓存状态:', cacheSteam: 'Steam:', cacheDB: '数据库:', justNow: '刚刚', minAgo: '分钟前', steamError: '⚠️ 未验证', steamErrorTip: 'Steam API 无法访问。版本未验证。', mirrorNoDate: '⚠️ 镜像无日期', mirrorNoDateTip: '无法验证镜像版本。', updateCache: '🔄 更新缓存', cacheCooldown: '⏳ 更新缓存 ({s}s)', idlePaused: '⏸️ 已暂停（空闲）', idleActive: '🟢 活跃' },
        zh_tw: { loading: '⏳ 正在尋找...', checkingVersion: '⏳ 正在檢查版本...', dbError: '⚠️ 資料庫錯誤', requestMod: '➕ 請求 Mod', modNotListed: 'Mod 未收錄。點擊請求。', download: '✅ 下載', downloadWarning: '⚠️ 下載', modUpdated: 'MOD 已是最新', modOutdated: 'MOD 已過期', requestUpdate: '在論壇請求更新', labelSteam: 'Steam:', labelInsane: '鏡像:', labelCache: '快取狀態:', cacheSteam: 'Steam:', cacheDB: '資料庫:', justNow: '剛剛', minAgo: '分鐘前', steamError: '⚠️ 未驗證', steamErrorTip: 'Steam API 無法訪問。版本未驗證。', mirrorNoDate: '⚠️ 鏡像無日期', mirrorNoDateTip: '無法驗證鏡像版本。', updateCache: '🔄 更新快取', cacheCooldown: '⏳ 更新快取 ({s}s)', idlePaused: '⏸️ 已暫停（閒置）', idleActive: '🟢 活躍' },
        ja: { loading: '⏳ 検索中...', checkingVersion: '⏳ バージョン確認中...', dbError: '⚠️ DBエラー', requestMod: '➕ Modをリクエスト', modNotListed: 'Modが未登録です。クリックしてリクエスト。', download: '✅ ダウンロード', downloadWarning: '⚠️ ダウンロード', modUpdated: 'MODは最新です', modOutdated: 'MODは古い可能性があります', requestUpdate: 'フォーラムで更新をリクエスト', labelSteam: 'Steam:', labelInsane: 'ミラー:', labelCache: 'キャッシュ状態:', cacheSteam: 'Steam:', cacheDB: 'データベース:', justNow: 'たった今', minAgo: '分前', steamError: '⚠️ 未検証', steamErrorTip: 'Steam APIにアクセスできません。バージョン未検証。', mirrorNoDate: '⚠️ 日付のないミラー', mirrorNoDateTip: 'ミラーのバージョンを確認できませんでした。', updateCache: '🔄 キャッシュを更新', cacheCooldown: '⏳ キャッシュ更新 ({s}s)', idlePaused: '⏸️ 一時停止（アイドル）', idleActive: '🟢 アクティブ' },
        ko: { loading: '⏳ 검색 중...', checkingVersion: '⏳ 버전 확인 중...', dbError: '⚠️ DB 오류', requestMod: '➕ 모드 요청', modNotListed: '모드가 목록에 없습니다. 클릭해서 요청하세요.', download: '✅ 다운로드', downloadWarning: '⚠️ 다운로드', modUpdated: 'MOD 최신 상태', modOutdated: 'MOD 오래됨', requestUpdate: '포럼에서 업데이트 요청', labelSteam: 'Steam:', labelInsane: '미러:', labelCache: '캐시 상태:', cacheSteam: 'Steam:', cacheDB: '데이터베이스:', justNow: '방금', minAgo: '분 전', steamError: '⚠️ 확인 안 됨', steamErrorTip: 'Steam API에 접근할 수 없습니다. 버전이 확인되지 않았습니다.', mirrorNoDate: '⚠️ 날짜 없는 미러', mirrorNoDateTip: '미러 버전을 확인할 수 없습니다.', updateCache: '🔄 캐시 업데이트', 캐시Cooldown: '⏳ 캐시 업데이트 ({s}s)', idlePaused: '⏸️ 일시 정지 (유휴)', idleActive: '🟢 활성' }
    };

    const languageAliases = {
        'pt-br': 'pt', 'pt-pt': 'pt', 'es-es': 'es', 'es-419': 'es',
        'fr-fr': 'fr', 'de-de': 'de', 'it-it': 'it', 'nl-nl': 'nl',
        'pl-pl': 'pl', 'ru-ru': 'ru', 'tr-tr': 'tr',
        'zh-cn': 'zh', 'zh-sg': 'zh', 'zh-hans': 'zh',
        'zh-tw': 'zh_tw', 'zh-hk': 'zh_tw', 'zh-hant': 'zh_tw',
        'ja-jp': 'ja', 'ko-kr': 'ko',
    };

    function getScriptLanguage() {
        const rawLang = (document.documentElement.lang || document.querySelector('html')?.getAttribute('lang') || navigator.language || 'en').toLowerCase();
        const normalized = rawLang.replace('_', '-');
        if (translations[normalized]) return normalized;
        if (languageAliases[normalized]) return languageAliases[normalized];
        const baseLang = normalized.split('-')[0];
        return translations[baseLang] ? baseLang : 'en';
    }

    const t = translations[getScriptLanguage()];

    // ========================================================================
    // 3. UTILITÁRIOS DE CACHE E CSS
    // ========================================================================

    function formatCacheAge(ms) {
        if (!ms || ms < 0 || isNaN(ms)) ms = 0;
        const minutes = Math.floor(ms / 60000);
        if (minutes < 1) return t.justNow;
        return `${minutes} ${t.minAgo}`;
    }

    function formatTimeLeft(expTimestamp) {
        if (!expTimestamp) return "0s";
        const left = expTimestamp - Date.now();
        if (left <= 0) return "0s";
        const m = Math.floor(left / 60000);
        const s = Math.floor((left % 60000) / 1000);
        return `${m}m ${s}s`;
    }

    let globalCacheCooldown = parseInt(localStorage.getItem(`${CACHE_PREFIX}Cooldown`) || '0', 10);

    function setGlobalCacheCooldown(ms) {
        globalCacheCooldown = Date.now() + ms;
        try { localStorage.setItem(`${CACHE_PREFIX}Cooldown`, globalCacheCooldown.toString()); } catch(err) {}
    }

    function saveCacheSafely(key, dataObj) {
        try {
            localStorage.setItem(key, JSON.stringify(dataObj));
        } catch(e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                try { localStorage.removeItem(key); localStorage.setItem(key, JSON.stringify(dataObj)); } catch(err) {}
            }
        }
    }

    const activeWidgets = new Set();

    function stopCardNav(el) {
        const stop = (e) => e.stopPropagation();
        ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(evt => el.addEventListener(evt, stop));
    }

    const style = document.createElement('style');
    style.innerHTML = `
        .insane-custom-btn { display: inline-flex !important; align-items: center !important; justify-content: center !important; padding: 0 15px !important; font-size: 13px !important; font-weight: bold !important; border-radius: 2px !important; text-decoration: none !important; white-space: nowrap !important; transition: all 0.2s ease-in-out !important; box-sizing: border-box !important; font-family: "Motiva Sans", Arial, Helvetica, sans-serif !important; box-shadow: 0 2px 5px rgba(0,0,0,0.2) !important; gap: 8px !important; z-index: 99 !important; height: 34px !important; text-shadow: 1px 1px 2px rgba(0,0,0,0.5) !important; margin: 0 !important; }
        .insane-custom-btn-compact { padding: 0 8px !important; font-size: 11px !important; border-radius: 2px !important; gap: 4px !important; height: 24px !important; }
        .insane-custom-btn:hover { filter: brightness(1.15) !important; }
        .insane-custom-btn:active { filter: brightness(0.9) !important; }
        .insane-state-loading { background: linear-gradient(to bottom, #343f4d 5%, #222933 95%) !important; color: #acb2b8 !important; border: 1px solid #455366 !important; cursor: wait !important; }
        .insane-state-info { background: linear-gradient(to bottom, #1a3c54 5%, #122436 95%) !important; color: #66c0f4 !important; border: 1px solid #2b5575 !important; cursor: pointer !important; }
        .insane-state-success { background: linear-gradient(to bottom, #3f5c1e 5%, #2c4015 95%) !important; color: #A3E33B !important; border: 1px solid #5a852a !important; cursor: pointer !important; }
        .insane-state-warning { background: linear-gradient(to bottom, #6b410c 5%, #452a08 95%) !important; color: #F59E0B !important; border: 1px solid #995c10 !important; cursor: pointer !important; }
        .insane-state-error { background: linear-gradient(to bottom, #612222 5%, #3d1616 95%) !important; color: #ff6b6b !important; border: 1px solid #8c3232 !important; cursor: pointer !important; }
        .insane-btn-group { position: relative; display: inline-flex; border-radius: 2px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: transform 0.2s; align-items: center; height: 100%; }
        .insane-btn-group:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(0,0,0,0.4); }
        .insane-btn-main { border-top-right-radius: 0 !important; border-bottom-right-radius: 0 !important; border-right: 1px solid rgba(0,0,0,0.4) !important; margin: 0 !important; box-shadow: none !important; }
        .insane-btn-main:hover { transform: none !important; box-shadow: none !important; }
        .insane-btn-arrow { border-top-left-radius: 0 !important; border-bottom-left-radius: 0 !important; padding: 0 8px !important; margin: 0 !important; box-shadow: none !important; }
        .insane-btn-arrow:hover { transform: none !important; box-shadow: none !important; }
        .insane-global-dropdown { position: fixed !important; background: #171a21; border: 1px solid #3d4450; border-radius: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.9); display: none; flex-direction: column; min-width: 220px; z-index: 2147483647 !important; overflow: hidden; margin: 0 !important; }
        .insane-global-dropdown.show { display: flex; }
        .insane-global-dropdown:popover-open { bottom: auto; right: auto; margin: 0 !important; }
        .insane-global-dropdown a { padding: 10px 12px; color: #acb2b8; text-decoration: none; font-size: 12px; transition: background 0.2s; font-family: "Motiva Sans", sans-serif; display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .insane-global-dropdown a:hover { background: #3d4450; color: #fff; }
        .insane-custom-tooltip { position: fixed !important; margin: 0 !important; z-index: 2147483647 !important; background: #171a21 !important; border: 1px solid #3d4450 !important; border-radius: 6px !important; padding: 12px !important; color: #acb2b8 !important; font-family: "Motiva Sans", Arial, sans-serif !important; font-size: 13px !important; box-shadow: 0 8px 16px rgba(0,0,0,0.9) !important; pointer-events: none !important; opacity: 0; transition: opacity 0.1s; white-space: nowrap !important; }
        .insane-custom-tooltip.show { opacity: 1 !important; }
        .insane-custom-tooltip:popover-open { bottom: auto; right: auto; margin: 0 !important; }
        .insane-tooltip-title { font-weight: bold; font-size: 14px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #3d4450; display: flex; align-items: center; gap: 6px; }
        .insane-tooltip-success { color: #A3E33B; } .insane-tooltip-warning { color: #F59E0B; } .insane-tooltip-error { color: #ff6b6b; }
        .insane-tooltip-row { margin: 4px 0; text-align: left !important; } .insane-tooltip-label { color: #8f98a0; display: inline-block; width: auto; min-width: 48px; margin-right: 4px; } .insane-tooltip-value { color: #E2E8F0; font-weight: 500; }
        #insane-widget-main { display: inline-flex; height: 34px; align-items: center; }
        .insane-widget-container { position: relative; z-index: 10; display: inline-flex; align-items: center; }
        .insane-widget-container:hover { z-index: 9999; }
    `;
    document.head.appendChild(style);

    // ========================================================================
    // 4. LÓGICA DE UI E EVENTOS NATIVOS
    // ========================================================================

    let popoverHideTimeouts = new WeakMap();

    function safeShowPopover(el) {
        if (typeof el.showPopover === 'function') {
            if (popoverHideTimeouts.has(el)) { clearTimeout(popoverHideTimeouts.get(el)); popoverHideTimeouts.delete(el); }
            try { if (!el.matches(':popover-open')) el.showPopover(); } catch(e) {}
        }
    }

    function safeHidePopover(el, delay = 0) {
        if (typeof el.hidePopover === 'function') {
            if (popoverHideTimeouts.has(el)) clearTimeout(popoverHideTimeouts.get(el));
            if (delay > 0) {
                const timeoutId = setTimeout(() => {
                    try { if (el.matches(':popover-open')) el.hidePopover(); } catch(e) {}
                    popoverHideTimeouts.delete(el);
                }, delay);
                popoverHideTimeouts.set(el, timeoutId);
            } else {
                try { if (el.matches(':popover-open')) el.hidePopover(); } catch(e) {}
                popoverHideTimeouts.delete(el);
            }
        }
    }

    const dropdownGlobal = document.createElement('div');
    dropdownGlobal.className = 'insane-global-dropdown';
    if (typeof dropdownGlobal.showPopover === 'function') dropdownGlobal.setAttribute('popover', 'manual');

    function updateDropdownCacheText() {
        const cacheBtn = dropdownGlobal.querySelector('#insane-clear-cache');
        if (!cacheBtn) return;
        const now = Date.now();
        if (now < globalCacheCooldown) {
            const s = Math.ceil((globalCacheCooldown - now) / 1000);
            cacheBtn.style.cursor = 'not-allowed';
            cacheBtn.style.opacity = '0.5';
            cacheBtn.innerHTML = t.cacheCooldown.replace('{s}', s);
        } else {
            cacheBtn.style.cursor = 'pointer';
            cacheBtn.style.opacity = '1';
            cacheBtn.innerHTML = t.updateCache;
        }
    }

    document.addEventListener('click', (e) => {
        const clearCacheBtn = e.target.closest('#insane-clear-cache');
        if (clearCacheBtn) {
            e.preventDefault(); e.stopPropagation();
            if (Date.now() >= globalCacheCooldown) {
                setGlobalCacheCooldown(30000);

                // Limpa Steam Cache
                localStorage.removeItem(STEAM_CACHE_KEY);
                steamDateCache = {};
                localSteamCache = {};
                pendingSteamIDs.clear();
                steamCallbacks.clear();

                // Limpa todos os DB Caches do Jogo atual (lidando com "full_db" e "per_mod")
                GAME.databases.forEach(db => {
                    if (db.type === 'per_mod') {
                        const prefix = `${CACHE_PREFIX}DB_${db.id}_`;
                        const keysToRemove = [];
                        for (let i = 0; i < localStorage.length; i++) {
                            const key = localStorage.key(i);
                            if (key && key.startsWith(prefix)) {
                                keysToRemove.push(key);
                            }
                        }
                        keysToRemove.forEach(k => localStorage.removeItem(k));
                        memoryDBCache[db.id] = {};
                    } else {
                        localStorage.removeItem(`${CACHE_PREFIX}DB_${db.id}`);
                        if (memoryDBCache[db.id]) memoryDBCache[db.id].exp = 0;
                    }
                });
                
                updateDropdownCacheText();
                dropdownGlobal.classList.remove('show');
                safeHidePopover(dropdownGlobal);
                dropdownGlobal.lastArrow = null;
                
                for (const container of activeWidgets) {
                    if (container.dataset.modid) renderWidget(container, container.dataset.modid, container.dataset.iscard === 'true');
                }
            }
            return;
        }

        const scriptLink = e.target.closest('a.insane-custom-btn, a.insane-bg-link');
        if (scriptLink && scriptLink.hasAttribute('href') && e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
            e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
            if (typeof GM_openInTab === 'function') GM_openInTab(scriptLink.href, { active: false, insert: true });
            else window.open(scriptLink.href, '_blank', 'noopener');

            if (scriptLink.classList.contains('insane-bg-link') && dropdownGlobal.classList.contains('show')) {
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null;
            }
            return;
        }

        const arrowBtn = e.target.closest('.insane-btn-arrow');
        if (arrowBtn) {
            e.preventDefault(); e.stopPropagation();
            if (dropdownGlobal.classList.contains('show') && dropdownGlobal.lastArrow === arrowBtn) {
                dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null;
                return;
            }
            const dialogParent = arrowBtn.closest('dialog');
            const rect = arrowBtn.getBoundingClientRect();
            let topPos = rect.bottom, leftPos = rect.right - 220;

            if (dialogParent) dialogParent.appendChild(dropdownGlobal);
            else document.body.appendChild(dropdownGlobal);

            if (typeof dropdownGlobal.showPopover !== 'function' && dialogParent) {
                const style = window.getComputedStyle(dialogParent);
                if (style.transform !== 'none') {
                    const dialogRect = dialogParent.getBoundingClientRect();
                    topPos -= dialogRect.top; leftPos -= dialogRect.left;
                }
            }

            const showForum = arrowBtn.getAttribute('data-show-forum') === 'true';
            const forumText = arrowBtn.classList.contains('insane-state-error') ? t.requestMod : t.requestUpdate;

            dropdownGlobal.innerHTML = `
                <a id="insane-clear-cache"></a>
                ${showForum ? `<a href="${GAME.forumUrl}" rel="noopener noreferrer" class="insane-bg-link"><span>💬</span> ${forumText}</a>` : ''}
            `;
            updateDropdownCacheText();
            
            dropdownGlobal.style.top = topPos + 'px'; dropdownGlobal.style.left = leftPos + 'px';
            dropdownGlobal.classList.add('show'); safeShowPopover(dropdownGlobal); dropdownGlobal.lastArrow = arrowBtn;
            return;
        }

        if (!e.target.closest('.insane-global-dropdown') && dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null;
        }
    }, true);

    window.addEventListener('scroll', () => { 
        if (dropdownGlobal.classList.contains('show')) {
            dropdownGlobal.classList.remove('show'); safeHidePopover(dropdownGlobal); dropdownGlobal.lastArrow = null; 
        }
        if (tooltipGlobal.classList.contains('show')) {
            clearTimeout(hoverTimer); tooltipGlobal.classList.remove('show'); safeHidePopover(tooltipGlobal); 
        }
    }, { passive: true });

    const tooltipGlobal = document.createElement('div');
    tooltipGlobal.className = 'insane-custom-tooltip';
    if (typeof tooltipGlobal.showPopover === 'function') tooltipGlobal.setAttribute('popover', 'manual');
    let hoverTimer;

    function refreshTooltipTimers() {
        tooltipGlobal.querySelectorAll('.insane-cache-countdown').forEach(el => {
            const exp = parseInt(el.getAttribute('data-exp'), 10);
            if (exp) el.innerText = formatTimeLeft(exp);
        });
        tooltipGlobal.querySelectorAll('.insane-cache-age').forEach(el => {
            const created = parseInt(el.getAttribute('data-created'), 10);
            if (created) el.innerText = formatCacheAge(Date.now() - created);
        });

        const idleStatusEl = tooltipGlobal.querySelector('.insane-idle-status');
        if (idleStatusEl) {
            idleStatusEl.innerHTML = (isIdleNow() || wasIdleRecently) 
                ? `<span style="color:#F59E0B">${t.idlePaused}</span>` 
                : `<span style="color:#A3E33B">${t.idleActive}</span>`;
        }
    }

    // ========================================================================
    // 5. OCIOSIDADE E SINCRONIZAÇÃO ENTRE ABAS
    // ========================================================================

    let globalCacheCleared = false;

    window.addEventListener('storage', (e) => {
        // Sincroniza o cooldown global
        if (e.key === `${CACHE_PREFIX}Cooldown`) {
            globalCacheCooldown = parseInt(e.newValue, 10) || 0;
            if (dropdownGlobal.classList.contains('show')) updateDropdownCacheText();
        }
        // Sincroniza a limpeza do cache da Steam
        if (e.key === STEAM_CACHE_KEY && e.newValue === null) {
            steamDateCache = {};
            localSteamCache = {};
            globalCacheCleared = true;
        }
        // Sincroniza a limpeza dos bancos de dados modulares
        if (e.key && e.key.startsWith(`${CACHE_PREFIX}DB_`) && e.newValue === null) {
            GAME.databases.forEach(db => {
                if (db.type === 'per_mod') {
                    if (e.key.startsWith(`${CACHE_PREFIX}DB_${db.id}_`)) {
                        const modId = e.key.replace(`${CACHE_PREFIX}DB_${db.id}_`, '');
                        if (memoryDBCache[db.id] && memoryDBCache[db.id][modId]) {
                            memoryDBCache[db.id][modId].exp = 0;
                        }
                        globalCacheCleared = true;
                    }
                } else {
                    if (e.key === `${CACHE_PREFIX}DB_${db.id}`) {
                        if (memoryDBCache[db.id]) memoryDBCache[db.id].exp = 0;
                        globalCacheCleared = true;
                    }
                }
            });
        }
    });

    const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
    let lastActivityTime = Date.now();
    let activityTimeout;
    let wasIdleRecently = false; 

    function isIdleNow() { return (Date.now() - lastActivityTime) > IDLE_TIMEOUT_MS; }

    function resetActivity() {
        if (!activityTimeout) {
            activityTimeout = setTimeout(() => {
                const now = Date.now();
                if (isIdleNow()) {
                    wasIdleRecently = true;
                    setTimeout(() => { wasIdleRecently = false; refreshTooltipTimers(); }, 4000);
                }
                lastActivityTime = now;
                activityTimeout = null;
            }, 1000); 
        }
    }

    ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(evt => window.addEventListener(evt, resetActivity, { passive: true }));

    setInterval(() => {
        if (dropdownGlobal.classList.contains('show')) updateDropdownCacheText();
        if (tooltipGlobal.classList.contains('show')) refreshTooltipTimers();

        if (!document.hidden && !isIdleNow()) {
            const now = Date.now();
            const forceUpdate = globalCacheCleared;
            if (forceUpdate) globalCacheCleared = false;

            for (const container of activeWidgets) {
                if (!document.documentElement.contains(container)) {
                    activeWidgets.delete(container);
                    continue;
                }
                
                const modId = container.dataset.modid;
                if (modId) {
                    const steamExpired = localSteamCache[modId] ? (now >= localSteamCache[modId].exp) : false;
                    if (steamExpired) delete steamDateCache[modId];
                    
                    let dbExpired = false;
                    if (container.dataset.activeDbIds) {
                        try {
                            const dbIds = JSON.parse(container.dataset.activeDbIds);
                            for (const dbId of dbIds) {
                                const dbConfig = GAME.databases.find(d => d.id === dbId);
                                if (dbConfig) {
                                    if (dbConfig.type === 'per_mod') {
                                        if (memoryDBCache[dbId] && memoryDBCache[dbId][modId] && now >= memoryDBCache[dbId][modId].exp) {
                                            dbExpired = true;
                                            break;
                                        }
                                    } else {
                                        if (memoryDBCache[dbId] && now >= memoryDBCache[dbId].exp) {
                                            dbExpired = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        } catch(e) {}
                    }

                    if ((dbExpired || steamExpired || forceUpdate) && !container.querySelector('.insane-state-loading')) {
                        if (container.matches(':hover')) {
                            tooltipGlobal.classList.remove('show');
                            safeHidePopover(tooltipGlobal);
                        }
                        renderWidget(container, modId, container.dataset.iscard === 'true');
                    }
                }
            }
        }
    }, 1000);

    function bindTooltip(element, htmlContent) {
        let lastX = 0, lastY = 0;

        const updatePos = () => {
            let left = lastX + 15, top = lastY + 15;
            const tooltipWidth = tooltipGlobal.offsetWidth || 200, tooltipHeight = tooltipGlobal.offsetHeight || 100;
            if (left + tooltipWidth > window.innerWidth - 10) left = lastX - tooltipWidth - 15;
            if (top + tooltipHeight > window.innerHeight - 10) top = lastY - tooltipHeight - 15;
            
            if (typeof tooltipGlobal.showPopover !== 'function') {
                const dialogParent = element.closest('dialog');
                if (dialogParent && window.getComputedStyle(dialogParent).transform !== 'none') {
                    const dialogRect = dialogParent.getBoundingClientRect(); left -= dialogRect.left; top -= dialogRect.top;
                }
            }
            tooltipGlobal.style.left = left + 'px'; tooltipGlobal.style.top = top + 'px';
        };

        element.addEventListener('mouseenter', (e) => {
            if (!document.documentElement.contains(element)) return;
            lastX = e.clientX; lastY = e.clientY;
            hoverTimer = setTimeout(() => {
                const dialogParent = element.closest('dialog');
                if (dialogParent) dialogParent.appendChild(tooltipGlobal); else document.body.appendChild(tooltipGlobal);
                
                tooltipGlobal.innerHTML = htmlContent;
                refreshTooltipTimers();

                tooltipGlobal.classList.add('show');
                safeShowPopover(tooltipGlobal);
                updatePos();
            }, 300);
        });

        element.addEventListener('mousemove', (e) => {
            lastX = e.clientX; lastY = e.clientY;
            if (tooltipGlobal.classList.contains('show')) updatePos();
        });

        element.addEventListener('mouseleave', () => {
            clearTimeout(hoverTimer);
            tooltipGlobal.classList.remove('show');
            safeHidePopover(tooltipGlobal, 100);
        });
    }

    // ========================================================================
    // 6. CACHES E GERENCIAMENTO DE DADOS (STEAM E FALLBACK DB)
    // ========================================================================

    let steamDateCache  = {};
    let localSteamCache = {};
    let pendingSteamIDs = new Set();
    let isFetchingBatch = false;
    let steamQueueTimeout = null;
    let steamCallbacks = new Map();

    function saveSteamCache() {
        const now = Date.now();
        let size = 0;
        for (const id in localSteamCache) {
            if (localSteamCache[id].exp < now) delete localSteamCache[id];
            else size++;
        }
        if (size > 5000) {
            const entries = Object.entries(localSteamCache).sort((a, b) => a[1].exp - b[1].exp);
            for(let i = 0; i < entries.length - 5000; i++) delete localSteamCache[entries[i][0]];
        }
        saveCacheSafely(STEAM_CACHE_KEY, localSteamCache);
    }

    try {
        const stored = localStorage.getItem(STEAM_CACHE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            const now = Date.now();
            for (const id in parsed) {
                if (parsed[id] && parsed[id].exp && now < parsed[id].exp) localSteamCache[id] = parsed[id];
            }
            saveSteamCache();
        }
    } catch(e) {}

    function triggerSteamFetch() {
        if (!isFetchingBatch && pendingSteamIDs.size > 0) {
            clearTimeout(steamQueueTimeout);
            steamQueueTimeout = setTimeout(processSteamQueue, 100);
        }
    }

    function handleSteamError(ids) {
        const now = Date.now();
        ids.forEach(id => {
            steamDateCache[id] = STEAM_FETCH_ERROR;
            localSteamCache[id] = { date: STEAM_FETCH_ERROR, exp: now + CACHE_TIME_STEAM_MS };
            pendingSteamIDs.delete(id);
            if (steamCallbacks.has(id)) { steamCallbacks.get(id).forEach(cb => cb()); steamCallbacks.delete(id); }
        });
        saveSteamCache();
        isFetchingBatch = false; triggerSteamFetch();
    }

    function processSteamQueue() {
        if (isFetchingBatch || pendingSteamIDs.size === 0) return;

        isFetchingBatch = true;
        const idsToFetch = Array.from(pendingSteamIDs).slice(0, 100);
        
        const formData = new URLSearchParams();
        formData.append('itemcount', idsToFetch.length.toString());
        idsToFetch.forEach((id, index) => formData.append(`publishedfileids[${index}]`, id));

        GM_xmlhttpRequest({
            method: 'POST', 
            url: 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
            data: formData.toString(), 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            onload: function(response) {
                if (response.status !== 200) return handleSteamError(idsToFetch);

                const now = Date.now();
                const handledIds = new Set();
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.response?.publishedfiledetails) {
                        data.response.publishedfiledetails.forEach(details => {
                            if (details.publishedfileid) {
                                const id = details.publishedfileid;
                                const timestamp = details.time_updated || details.time_created;
                                const dateVal = timestamp ? new Date(timestamp * 1000) : STEAM_NO_DATE;

                                steamDateCache[id] = dateVal;
                                localSteamCache[id] = {
                                    date: dateVal === STEAM_NO_DATE ? STEAM_NO_DATE : dateVal.toISOString(),
                                    exp: now + CACHE_TIME_STEAM_MS
                                };
                                handledIds.add(id);
                            }
                        });
                    }
                } catch(e) { return handleSteamError(idsToFetch); }

                idsToFetch.forEach(id => {
                    if (!handledIds.has(id)) {
                        steamDateCache[id] = STEAM_NO_DATE;
                        localSteamCache[id] = { date: STEAM_NO_DATE, exp: now + CACHE_TIME_STEAM_MS };
                    }
                    pendingSteamIDs.delete(id);
                    if (steamCallbacks.has(id)) { steamCallbacks.get(id).forEach(cb => cb()); steamCallbacks.delete(id); }
                });

                saveSteamCache();
                isFetchingBatch = false; triggerSteamFetch();
            },
            onerror: () => handleSteamError(idsToFetch)
        });
    }

    function getSteamDateAsync(modId) {
        return new Promise(resolve => {
            let dataSteam = steamDateCache[modId];
            if (dataSteam === undefined && localSteamCache[modId] && Date.now() < localSteamCache[modId].exp) {
                const cachedVal = localSteamCache[modId].date;
                dataSteam = steamDateCache[modId] = (cachedVal === STEAM_NO_DATE || cachedVal === STEAM_FETCH_ERROR) ? cachedVal : new Date(cachedVal);
            }

            if (dataSteam !== undefined) {
                resolve(dataSteam);
                return;
            }

            pendingSteamIDs.add(modId);
            if (!steamCallbacks.has(modId)) steamCallbacks.set(modId, new Set());
            steamCallbacks.get(modId).add(() => resolve(steamDateCache[modId]));
            triggerSteamFetch();
        });
    }

    const memoryDBCache = {}; 
    const pendingDBRequests = {}; 

    function fetchDatabaseAsync(dbConfig, modId = null) {
        if (dbConfig.type === 'per_mod') {
            if (!modId) return Promise.resolve(null);
            const cacheKey = `${CACHE_PREFIX}DB_${dbConfig.id}_${modId}`;
            const now = Date.now();

            if (!memoryDBCache[dbConfig.id]) memoryDBCache[dbConfig.id] = {};
            
            if (memoryDBCache[dbConfig.id][modId] && memoryDBCache[dbConfig.id][modId].exp > now) {
                return Promise.resolve(memoryDBCache[dbConfig.id][modId]);
            }

            const requestKey = `${dbConfig.id}_${modId}`;
            if (pendingDBRequests[requestKey]) {
                return pendingDBRequests[requestKey];
            }

            try {
                const stored = localStorage.getItem(cacheKey);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && parsed.exp > now) {
                        if (parsed.data && parsed.data.date) parsed.data.date = new Date(parsed.data.date);
                        memoryDBCache[dbConfig.id][modId] = parsed;
                        return Promise.resolve(parsed);
                    }
                }
            } catch(e) {}

            const requestPromise = new Promise((resolve) => {
                const url = dbConfig.url(modId);
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url + (url.includes('?') ? '&' : '?') + '_t=' + now,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            try {
                                const parsedData = dbConfig.parser(res.responseText, modId);
                                const exp = now + dbConfig.cacheTime;
                                const cacheObj = { data: parsedData, exp: exp, creation: now };
                                
                                memoryDBCache[dbConfig.id][modId] = cacheObj;
                                saveCacheSafely(cacheKey, cacheObj);
                                delete pendingDBRequests[requestKey];
                                return resolve(cacheObj);
                            } catch(e) {
                                console.error(`[SWDD] Fallback Error (DB: ${dbConfig.name}):`, e);
                            }
                        }
                        delete pendingDBRequests[requestKey];
                        resolve(null);
                    },
                    onerror: () => {
                        delete pendingDBRequests[requestKey];
                        resolve(null);
                    }
                });
            });

            pendingDBRequests[requestKey] = requestPromise;
            return requestPromise;

        } else {
            // Banco Full (Puxa tudo e guarda)
            const cacheKey = `${CACHE_PREFIX}DB_${dbConfig.id}`;
            const now = Date.now();

            if (memoryDBCache[dbConfig.id] && memoryDBCache[dbConfig.id].exp > now) {
                return Promise.resolve(memoryDBCache[dbConfig.id]);
            }

            if (pendingDBRequests[dbConfig.id]) {
                return pendingDBRequests[dbConfig.id];
            }

            try {
                const stored = localStorage.getItem(cacheKey);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && parsed.exp > now) {
                        if (parsed.data) {
                            for(let k in parsed.data) {
                                if(parsed.data[k].date) parsed.data[k].date = new Date(parsed.data[k].date);
                            }
                        }
                        memoryDBCache[dbConfig.id] = parsed;
                        return Promise.resolve(parsed);
                    }
                }
            } catch(e) {}

            const requestPromise = new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: dbConfig.url + (dbConfig.url.includes('?') ? '&' : '?') + '_t=' + now,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            try {
                                const parsedData = dbConfig.parser(res.responseText);
                                const exp = now + dbConfig.cacheTime;
                                const cacheObj = { data: parsedData, exp: exp, creation: now };
                                
                                memoryDBCache[dbConfig.id] = cacheObj;
                                saveCacheSafely(cacheKey, cacheObj);
                                delete pendingDBRequests[dbConfig.id];
                                return resolve(cacheObj);
                            } catch(e) {
                                console.error(`[SWDD] Fallback Error (DB: ${dbConfig.name}):`, e);
                            }
                        }
                        delete pendingDBRequests[dbConfig.id];
                        resolve(null);
                    },
                    onerror: () => {
                        delete pendingDBRequests[dbConfig.id];
                        resolve(null);
                    }
                });
            });

            pendingDBRequests[dbConfig.id] = requestPromise;
            return requestPromise;
        }
    }

    async function getBestModFromDatabases(modId, dataSteam) {
        const consultedDBs = [];
        let bestOutdated = null;

        for (const dbConfig of GAME.databases) {
            let dbCacheObj;
            let modData = null;

            if (dbConfig.type === 'per_mod') {
                dbCacheObj = await fetchDatabaseAsync(dbConfig, modId);
                if (dbCacheObj && dbCacheObj.data) {
                    modData = dbCacheObj.data;
                }
            } else {
                dbCacheObj = await fetchDatabaseAsync(dbConfig);
                if (dbCacheObj && dbCacheObj.data && dbCacheObj.data[modId]) {
                    modData = dbCacheObj.data[modId];
                }
            }
            
            // Registra que esse banco foi consultado para aparecer no tooltip dinâmico
            if (dbCacheObj) {
                consultedDBs.push({
                    id: dbConfig.id,
                    name: dbConfig.name,
                    exp: dbCacheObj.exp,
                    creation: dbCacheObj.creation
                });
            } else {
                consultedDBs.push({
                    id: dbConfig.id,
                    name: dbConfig.name,
                    exp: 0,
                    creation: 0,
                    error: true
                });
            }

            if (modData) {
                const dataInsane = modData.date;
                
                let isUpdated = false;
                if (dataSteam === STEAM_NO_DATE || dataSteam === STEAM_FETCH_ERROR) {
                    isUpdated = true;
                } else if (!dataInsane) {
                    isUpdated = false; 
                } else if (utils.isUpToDate(dataInsane, dataSteam)) {
                    isUpdated = true;
                }

                if (isUpdated) {
                    return { 
                        dbId: dbConfig.id,
                        dbName: dbConfig.name, 
                        modData: modData,
                        exp: dbCacheObj.exp,
                        creation: dbCacheObj.creation,
                        consultedDBs: consultedDBs
                    };
                } else {
                    if (!bestOutdated || (dataInsane && bestOutdated.modData.date && dataInsane > bestOutdated.modData.date)) {
                        bestOutdated = {
                            dbId: dbConfig.id,
                            dbName: dbConfig.name,
                            modData: modData,
                            exp: dbCacheObj.exp,
                            creation: dbCacheObj.creation
                        };
                    }
                }
            }
        }

        if (bestOutdated) {
            bestOutdated.consultedDBs = consultedDBs;
            return bestOutdated;
        }

        return { consultedDBs: consultedDBs, notFound: true };
    }

    // ========================================================================
    // 7. RENDERIZAÇÃO PRINCIPAL DO WIDGET
    // ========================================================================

    async function renderWidget(container, modId, isCard) {
        const cClass = isCard ? 'insane-custom-btn-compact' : '';
        container.innerHTML = `<a class="insane-custom-btn ${cClass} insane-state-loading">${t.checkingVersion}</a>`;

        const dataSteam = await getSteamDateAsync(modId);
        const dbResult = await getBestModFromDatabases(modId, dataSteam);

        const steamCacheExp = localSteamCache[modId] ? localSteamCache[modId].exp : 0;
        const creationTimeSteam = steamCacheExp ? (steamCacheExp - CACHE_TIME_STEAM_MS) : Date.now();

        const strSteamCache  = formatCacheAge(Date.now() - creationTimeSteam);
        const strSteamReset  = formatTimeLeft(steamCacheExp);

        let dbCacheRowsHtml = '';
        const consultedDBs = dbResult ? dbResult.consultedDBs : [];
        for (const cdb of consultedDBs) {
            if (cdb.error) {
                dbCacheRowsHtml += `<span class="insane-tooltip-value" style="font-size:11px; color:#ff6b6b;">${cdb.name}: ${t.dbError}</span>`;
            } else {
                const strInsaneCache = formatCacheAge(Date.now() - cdb.creation);
                const strInsaneReset = formatTimeLeft(cdb.exp);
                dbCacheRowsHtml += `<span class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${cdb.name}: <span class="insane-cache-age" data-created="${cdb.creation}">${strInsaneCache}</span> (🔄 <span class="insane-cache-countdown" data-exp="${cdb.exp}">${strInsaneReset}</span>)</span>`;
            }
        }

        const cacheInfoHtml = `
            <div class="insane-tooltip-row" style="margin-top: 8px; border-top: 1px solid #3d4450; padding-top: 6px;">
                <div style="color: #66c0f4; font-weight: bold; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <span>${t.labelCache}</span><span class="insane-idle-status" style="font-size:11px; font-weight:normal;"></span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 3px;">
                    <span class="insane-tooltip-value" style="font-size:11px; color:#8f98a0;">${t.cacheSteam} <span class="insane-cache-age" data-created="${creationTimeSteam}">${strSteamCache}</span> (🔄 <span class="insane-cache-countdown" data-exp="${steamCacheExp}">${strSteamReset}</span>)</span>
                    ${dbCacheRowsHtml}
                </div>
            </div>`;

        if (!dbResult || dbResult.notFound) {
            container.innerHTML = `<div class="insane-btn-group"><a href="${GAME.forumUrl}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-error insane-btn-main">${t.requestMod}</a><button class="insane-custom-btn ${cClass} insane-state-error insane-btn-arrow" data-show-forum="false">▼</button></div>`;
            bindTooltip(container.firstElementChild, `<div class="insane-tooltip-title insane-tooltip-error"><span>❌</span> ${t.modNotListed}</div>${cacheInfoHtml}`);
            return;
        }

        const { dbId, dbName, modData, exp, creation } = dbResult;
        const dataInsane = modData.date;

        delete container.dataset.activeDbId;
        container.dataset.activeDbIds = JSON.stringify(consultedDBs.map(db => db.id));

        const strInsane = dataInsane ? dataInsane.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';
        const strSteam  = (dataSteam && dataSteam !== STEAM_NO_DATE && dataSteam !== STEAM_FETCH_ERROR) ? dataSteam.toLocaleString([], {dateStyle: 'short', timeStyle: 'short'}) : 'N/A';

        const steamRowHtml = `<div class="insane-tooltip-row"><span class="insane-tooltip-label">${t.labelSteam}</span> <span class="insane-tooltip-value">${strSteam}</span></div>`;
        const mirrorRowHtml = `<div class="insane-tooltip-row"><span class="insane-tooltip-label" style="color: #66c0f4;">${dbName}:</span> <span class="insane-tooltip-value">${strInsane}</span></div>`;

        if (dataSteam === STEAM_FETCH_ERROR) {
            container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-error insane-btn-main">${t.steamError}</a><button class="insane-custom-btn ${cClass} insane-state-error insane-btn-arrow" data-show-forum="false">▼</button></div>`;
            bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-error"><span>🔌</span> ${t.steamErrorTip}</div>${mirrorRowHtml}${cacheInfoHtml}`);
        } else if (!dataInsane) {
            container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-warning insane-btn-main">${t.downloadWarning}</a><button class="insane-custom-btn ${cClass} insane-state-warning insane-btn-arrow" data-show-forum="false">▼</button></div>`;
            bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> ${dbName} sem data</div><div class="insane-tooltip-row"><span class="insane-tooltip-label">Info:</span> <span class="insane-tooltip-value">${t.mirrorNoDateTip}</span></div>${cacheInfoHtml}`);
        } else if (utils.isUpToDate(dataInsane, dataSteam)) {
            container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-success insane-btn-main">${t.download}</a><button class="insane-custom-btn ${cClass} insane-state-success insane-btn-arrow" data-show-forum="false">▼</button></div>`;
            bindTooltip(container.firstElementChild, `<div class="insane-tooltip-title insane-tooltip-success"><span>✅</span> ${t.modUpdated}</div>${steamRowHtml}${mirrorRowHtml}${cacheInfoHtml}`);
        } else {
            container.innerHTML = `<div class="insane-btn-group"><a href="${modData.link}" rel="noopener noreferrer" class="insane-custom-btn ${cClass} insane-state-warning insane-btn-main">${t.downloadWarning}</a><button class="insane-custom-btn ${cClass} insane-state-warning insane-btn-arrow" data-show-forum="true">▼</button></div>`;
            bindTooltip(container.querySelector('.insane-btn-group'), `<div class="insane-tooltip-title insane-tooltip-warning"><span>⚠️</span> ${t.modOutdated}</div>${steamRowHtml}${mirrorRowHtml}${cacheInfoHtml}`);
        }
    }

    // ========================================================================
    // 8. INJEÇÃO NA DOM (OBSERVER E QUERY SELECTORS)
    // ========================================================================

    function injectWidgets() {
        const urlStr = window.location.href;
        
        if (urlStr.includes("/sharedfiles/filedetails") || urlStr.includes("/workshop/filedetails")) {
            const steamBtn = document.getElementById('SubscribeItemBtn');
            if (steamBtn && !steamBtn.dataset.swddInjected) {
                const modId = new URLSearchParams(window.location.search).get('id');
                const subscribeControls = steamBtn.parentElement;

                if (modId && subscribeControls) {
                    steamBtn.dataset.swddInjected = 'true';
                    const gameArea = subscribeControls.parentElement;
                    if (gameArea && gameArea.classList.contains('game_area_purchase_game')) {
                        gameArea.style.display = 'flex'; gameArea.style.flexWrap = 'wrap';
                        gameArea.style.alignItems = 'center'; gameArea.style.justifyContent = 'space-between';
                        gameArea.style.gap = '15px';
                        const titleH1 = gameArea.querySelector('h1');
                        if (titleH1) { titleH1.style.float = 'none'; titleH1.style.width = 'auto'; titleH1.style.flex = '1 1 auto'; titleH1.style.margin = '0'; }
                    }

                    subscribeControls.style.float = 'none'; subscribeControls.style.display = 'flex';
                    subscribeControls.style.flexWrap = 'wrap'; subscribeControls.style.alignItems = 'center';
                    subscribeControls.style.justifyContent = 'flex-end'; subscribeControls.style.gap = '10px';
                    steamBtn.style.flexShrink = '0'; steamBtn.style.margin = '0';

                    const container = document.createElement('div');
                    container.id = 'insane-widget-main';
                    container.dataset.modid = modId;
                    container.dataset.iscard = 'false';

                    steamBtn.insertAdjacentElement('beforebegin', container);
                    stopCardNav(container);
                    activeWidgets.add(container);
                    renderWidget(container, modId, false);
                }
            }
        }

        document.querySelectorAll('h2 a[href*="?id="]').forEach(titleLink => {
            if (titleLink.dataset.swddInjected) return;
            const href = titleLink.getAttribute('href');
            if (!href.includes('sharedfiles/filedetails') && !href.includes('workshop/filedetails')) return;

            titleLink.dataset.swddInjected = 'true';
            let modalRoot = titleLink;
            for(let i = 0; i < 6; i++) { if(modalRoot.parentElement) modalRoot = modalRoot.parentElement; }

            const subscribeBtn = Array.from(modalRoot.querySelectorAll('button')).find(b => b.getAttribute('data-accent-color') === 'green' || b.querySelector('.SVGIcon_Plus'));
            if (!subscribeBtn) return;

            const anchor = subscribeBtn.closest('.tool-tip-source') || subscribeBtn;
            if (!anchor.parentElement.querySelector('.insane-widget-container')) {
                const container = document.createElement('div');
                container.className = 'insane-widget-container'; container.style.marginRight = '8px';
                container.dataset.modid = new URL(titleLink.href).searchParams.get('id');
                container.dataset.iscard = 'false';

                stopCardNav(container);
                anchor.insertAdjacentElement('beforebegin', container);
                activeWidgets.add(container);
                if (container.dataset.modid) renderWidget(container, container.dataset.modid, false);
            }
        });

        document.querySelectorAll('.SVGIcon_MagnifyingGlass').forEach(zoomIcon => {
            if (zoomIcon.dataset.swddInjected) return;
            zoomIcon.dataset.swddInjected = 'true';

            const actionRow = (zoomIcon.closest('[role="button"]') || zoomIcon.parentElement)?.parentElement;
            if (!actionRow || actionRow.querySelector('.insane-widget-container')) return;

            let cardContainer = actionRow.parentElement, modLink = null;
            for (let i = 0; i < 5; i++) {
                if (!cardContainer) break;
                modLink = cardContainer.querySelector('a[href*="?id="]');
                if (modLink) break;
                cardContainer = cardContainer.parentElement;
            }
            if (!modLink || modLink.parentElement.tagName === 'H2') return;
            const href = modLink.getAttribute('href');
            if (!href.includes('sharedfiles/filedetails') && !href.includes('workshop/filedetails')) return;

            actionRow.style.setProperty('opacity', '1', 'important');
            actionRow.style.setProperty('visibility', 'visible', 'important');
            actionRow.style.display = 'flex'; actionRow.style.alignItems = 'center'; actionRow.style.gap = '6px';

            const container = document.createElement('div');
            container.className = 'insane-widget-container';
            container.dataset.modid = new URL(modLink.href).searchParams.get('id');
            container.dataset.iscard = 'true';

            stopCardNav(container);
            actionRow.prepend(container);
            activeWidgets.add(container);
            if (container.dataset.modid) renderWidget(container, container.dataset.modid, true);
        });
    }

    let domCheckTimeout;
    const observer = new MutationObserver((mutations) => {
        let hasElementNodes = mutations.some(m => Array.from(m.addedNodes).some(n => n.nodeType === 1));
        if (hasElementNodes) {
            clearTimeout(domCheckTimeout);
            domCheckTimeout = setTimeout(injectWidgets, 150);
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    injectWidgets();

})();
