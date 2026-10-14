/**
 * 本地测试脚本
 *
 * 用法：
 *   1. 先装依赖：  npm install
 *   2. 提供服务器信息（三选一，优先级从高到低）：
 *        a) 环境变量： SUBSONIC_URL / SUBSONIC_USER / SUBSONIC_PASS
 *        b) 同目录下的 test-config.json：{"serverUrl":"...","username":"...","password":"..."}
 *        c) 都没有的话，脚本会提示你输入
 *   3. 跑：        npm test
 *
 * 说明：MusicFree 里的 env.getUserVariables() 在本地不存在，这里用 global.env 模拟。
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function loadConfig() {
    // a) 环境变量
    if (process.env.SUBSONIC_URL && process.env.SUBSONIC_USER && process.env.SUBSONIC_PASS) {
        return {
            serverUrl: process.env.SUBSONIC_URL,
            username: process.env.SUBSONIC_USER,
            password: process.env.SUBSONIC_PASS
        };
    }
    // b) test-config.json
    const cfgPath = path.join(__dirname, 'test-config.json');
    if (fs.existsSync(cfgPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (cfg.serverUrl && cfg.username && cfg.password) return cfg;
        } catch (e) {
            console.warn('test-config.json 解析失败：', e.message);
        }
    }
    return null;
}

async function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(question, (answer) => {
        rl.close();
        resolve(String(answer || '').trim());
    }));
}

function line(title) {
    console.log('\n================ ' + title + ' ================');
}

function brief(item) {
    if (!item) return '(null)';
    return JSON.stringify({
        id: item.id,
        title: item.title || item.name,
        artist: item.artist,
        album: item.album,
        duration: item.duration
    });
}

async function run(cfg) {
    // 模拟 MusicFree 的 env
    global.env = {
        getUserVariables: () => cfg,
        os: process.platform,
        appVersion: '0.0.0-test',
        lang: 'zh-CN'
    };

    const plugin = require('./navidrome.js');
    console.log('插件：', plugin.platform, 'v' + plugin.version);

    // ---- 0. 连通性 ----
    line('0. 连通性检查 (ping)');
    const axios = require('axios');
    const CryptoJS = require('crypto-js');
    const salt = 'testsalt';
    const token = CryptoJS.MD5(cfg.password + salt).toString(CryptoJS.enc.Hex);
    const pingBase = String(cfg.serverUrl).replace(/\/+$/, '');
    try {
        const res = await axios.get(pingBase + '/rest/ping.view', {
            params: { u: cfg.username, t: token, s: salt, v: '1.16.1', c: 'MusicFree', f: 'json' },
            timeout: 9000
        });
        const root = res.data && res.data['subsonic-response'];
        if (!root) throw new Error('返回里没有 subsonic-response，地址可能不对');
        if (root.status !== 'ok') throw new Error('状态：' + root.status + ' ' + (root.error && root.error.message));
        console.log('✓ 连上了。服务器版本', root.version, '/ 类型', root.type);
    } catch (e) {
        console.error('✗ 连接失败：', e.message);
        console.error('  请检查 serverUrl 是否能访问、用户名密码是否正确。后面的测试不再继续。');
        process.exitCode = 1;
        return;
    }

    // ---- 1. 搜索歌曲 ----
    line('1. search(music)');
    let musicResult = { isEnd: true, data: [] };
    try {
        musicResult = await plugin.search('a', 1, 'music');
        console.log('结果数量：', musicResult.data.length, '| isEnd：', musicResult.isEnd);
        if (musicResult.data[0]) console.log('第一条：', brief(musicResult.data[0]));
    } catch (e) {
        console.error('✗ 失败：', e.message);
        process.exitCode = 1;
    }

    // ---- 2. 播放/下载链接 ----
    if (musicResult.data[0]) {
        line('2. getMediaSource');
        for (const q of ['standard', 'super']) {
            try {
                const src = await plugin.getMediaSource(musicResult.data[0], q);
                const ok = src && src.url && src.url.indexOf('/rest/stream.view') >= 0;
                console.log((ok ? '✓ ' : '✗ ') + q + '：', src && src.url);
                if (!ok) process.exitCode = 1;
            } catch (e) {
                console.error('✗ ' + q + ' 失败：', e.message);
                process.exitCode = 1;
            }
        }

        line('3. getLyric');
        try {
            const lrc = await plugin.getLyric(musicResult.data[0]);
            console.log('✓ 歌词长度：', (lrc.rawLrc || '').length, '字符');
        } catch (e) {
            console.log('· 无歌词（正常，很多服务器没有）：', e.message);
        }

        line('4. getMusicInfo');
        try {
            const info = await plugin.getMusicInfo(musicResult.data[0]);
            console.log('✓ 补全字段：', JSON.stringify({ title: info.title, album: info.album, hasArtwork: !!info.artwork }));
        } catch (e) {
            console.error('✗ 失败：', e.message);
            process.exitCode = 1;
        }
    }

    // ---- 5. 专辑搜索与详情 ----
    line('5. search(album) + getAlbumInfo');
    try {
        const albumResult = await plugin.search('a', 1, 'album');
        console.log('专辑数量：', albumResult.data.length);
        if (albumResult.data[0]) {
            console.log('第一条：', JSON.stringify({ id: albumResult.data[0].id, title: albumResult.data[0].title }));
            const detail = await plugin.getAlbumInfo(albumResult.data[0], 1);
            console.log('✓ 专辑内歌曲：', detail.musicList.length, '首 | isEnd：', detail.isEnd);
        }
    } catch (e) {
        console.error('✗ 失败：', e.message);
        process.exitCode = 1;
    }

    // ---- 6. 歌手 ----
    line('6. search(artist) + getArtistWorks');
    try {
        const artistResult = await plugin.search('a', 1, 'artist');
        console.log('歌手数量：', artistResult.data.length);
        if (artistResult.data[0]) {
            const works = await plugin.getArtistWorks(artistResult.data[0], 1, 'album');
            console.log('✓ 该歌手专辑：', works.data.length, '张');
        }
    } catch (e) {
        console.error('✗ 失败：', e.message);
        process.exitCode = 1;
    }

    // ---- 7. 歌单 ----
    line('7. search(sheet) + getMusicSheetInfo');
    try {
        const sheetResult = await plugin.search('', 1, 'sheet');
        console.log('歌单数量：', sheetResult.data.length);
        if (sheetResult.data[0]) {
            console.log('第一条：', JSON.stringify({ id: sheetResult.data[0].id, title: sheetResult.data[0].title }));
            const sheet = await plugin.getMusicSheetInfo(sheetResult.data[0], 1);
            console.log('✓ 歌单内歌曲：', sheet.musicList.length, '首');
        }
    } catch (e) {
        console.error('✗ 失败：', e.message);
        process.exitCode = 1;
    }

    // ---- 8. 榜单 ----
    line('8. getTopLists + getTopListDetail');
    try {
        const tops = await plugin.getTopLists();
        console.log('榜单数：', tops[0].data.length);
        for (const t of tops[0].data) {
            const d = await plugin.getTopListDetail(t, 1);
            console.log('✓ ' + t.title + '：', d.musicList.length, '首');
        }
    } catch (e) {
        console.error('✗ 失败：', e.message);
        process.exitCode = 1;
    }

    // ---- 9. 流派 ----
    line('9. getRecommendSheetTags + getRecommendSheetsByTag');
    try {
        const tags = await plugin.getRecommendSheetTags();
        const list = (tags.data[0] && tags.data[0].data) || [];
        console.log('流派数：', list.length, list.slice(0, 5).map((t) => t.title).join(' / '));
        if (list[0]) {
            const albums = await plugin.getRecommendSheetsByTag(list[0], 1);
            console.log('✓ 该流派专辑：', albums.data.length, '张');
        }
    } catch (e) {
        console.error('✗ 失败：', e.message);
        process.exitCode = 1;
    }

    line('测试结束');
}

(async () => {
    let cfg = loadConfig();
    if (!cfg) {
        console.log('没有找到服务器配置，请输入（也可以存成 test-config.json 或用环境变量）：');
        const serverUrl = await ask('服务器地址 (如 https://music.example.com)：');
        const username = await ask('用户名：');
        const password = await ask('密码：');
        cfg = { serverUrl, username, password };
    }
    console.log('目标服务器：', cfg.serverUrl);
    await run(cfg);
})();
