// index.js（MSR终端·稳定版）
require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ytdl = require('ytdl-core-discord');
const fs = require('fs');
const { exec } = require('child_process');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const path = require('path');
const playlistsDir = path.join(__dirname, 'playlists');
if (!fs.existsSync(playlistsDir)) fs.mkdirSync(playlistsDir);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

let queue = [];
let lastUsedChannel = null; // 🔁 存储最近一次 interaction 的文字频道
let currentIndex = 0;
let isLooping = false; // 单曲循环
let isListLooping = false; // 列表循环
let isShuffle = false;
let player = createAudioPlayer();
let connection = null;
let skipRequested = false;


function cleanUp() {
  if (connection) {
    try {
      connection.destroy();
    } catch {}
    connection = null;
  }
  try {
    fs.unlinkSync('temp_audio.mp3');
  } catch {}
  queue = [];
  currentIndex = 0;
  isLooping = false;
  isListLooping = false;
  player.stop();
}


function extractURL(text) {
  const urlMatch = text.match(/https?:\/\/[\S]+/);
  return urlMatch ? urlMatch[0] : null;
}

async function playCurrent(interaction = null) {
  let contextChannel = interaction?.channel || lastUsedChannel;
  if (!queue[currentIndex]) {
    if (interaction?.channel) lastUsedChannel = interaction.channel;
    interaction.followUp('🎵 当前播放列表为空。');
    return;
  }
  const url = queue[currentIndex];
  try {
    if (url.includes('bilibili.com')) {
      const match = url.match(/p=(\d+)/);
      const page = match ? match[1] : '1'; // 默认第 1 集
      const finalCommand = `yt-dlp -f bestaudio --playlist-items ${page} -o temp_audio.mp3 "${url}"`;
    
      exec(finalCommand, (error) => {
        if (error) return interaction.followUp('❌ 无法解析B站链接');
        try {
          const resource = createAudioResource('temp_audio.mp3');
          player.play(resource);
          interaction.followUp(`🎧 正在播放B站音源：${url}（第 ${page} 集）`);
        } catch (err) {
          interaction.followUp(`❌ 播放失败：${err.message}`);
        }
      });
    } else {
      const stream = await ytdl(url, { filter: 'audioonly' });
      const resource = createAudioResource(stream);
      player.play(resource);
      interaction.followUp(`▶️ 正在执行：第 ${currentIndex + 1} 首音源\n🎧 来源：${url}`);
    }
  } catch (err) {
    interaction.followUp(`❌ 解析失败，可能链接无效：${url}`);
  }
}

player.on(AudioPlayerStatus.Idle, async () => {
  try { fs.unlinkSync('temp_audio.mp3'); } catch {}

  console.log(`🧭 当前索引：${currentIndex}，队列长度：${queue.length}，单曲循环：${isLooping}，列表循环：${isListLooping}`);

  if (isLooping) {
    playCurrent({ followUp: () => {} });
  } else if (skipRequested) {
    skipRequested = false;
    if (currentIndex + 1 < queue.length) {
      currentIndex++;
      playCurrent({ followUp: () => {} });
    } else if (isListLooping && queue.length > 0) {
      currentIndex = 0;
      playCurrent({ followUp: () => {} });
    } else {
      console.log('⏹️ 跳过失败：已经是最后一首，且未开启列表循环');
    }
  } else if (currentIndex + 1 < queue.length) {
    currentIndex++;
    playCurrent({ followUp: () => {} });
  } else if (isListLooping && queue.length > 0) {
    currentIndex = 0;
    playCurrent({ followUp: () => {} });
  } else {
    console.log('✅ 正常播放结束。等待用户操作。');
    
    // 🆕 查找一个有效的文本频道发送提示
    const textChannel = lastUsedChannel;
    if (textChannel) {
      textChannel.send(
        '📭 【播放完毕】博士，当前音源已全部调度。\n📌 若需继续作战，请使用 `/msr_listloop` 开启轮转式循环。'
      );           
    }
    
    if (textChannel) {
      textChannel.send(
        '📭【调度提示】当前作战音源列表已全部调度完毕。\n📌 可使用 `/msr_listloop` 启用轮转式再调度。博士，请继续指示。'
      );
    } else {
      console.log('⚠️ 未能找到可用的文本频道发送提示。');
    }
  }
});



const commands = [
  new SlashCommandBuilder().setName('msr_join').setDescription('让MSR加入语音频道'),
  new SlashCommandBuilder().setName('msr_leave').setDescription('让MSR离开语音频道'),
  new SlashCommandBuilder().setName('msr_call').setDescription('向塞壬调度台提交音源').addStringOption(opt => opt.setName('url').setDescription('音源链接').setRequired(true)),
  new SlashCommandBuilder().setName('msr_suspend').setDescription('暂停当前音源'),
  new SlashCommandBuilder().setName('msr_resume').setDescription('继续执行音源'),
  new SlashCommandBuilder().setName('msr_skip').setDescription('切换至下一个音源'),
  new SlashCommandBuilder().setName('msr_queue').setDescription('查看当前任务列队'),
  new SlashCommandBuilder().setName('msr_loop').setDescription('切换单曲循环'),
  new SlashCommandBuilder().setName('msr_randomize').setDescription('重新洗牌当前列队'),
  new SlashCommandBuilder().setName('msr_abort').setDescription('紧急终止音源播放'),
  new SlashCommandBuilder().setName('msr_id').setDescription('查询当前播放音源编号'),
  new SlashCommandBuilder().setName('msr_save').setDescription('保存当前列队为歌单')
  .addStringOption(opt => opt.setName('name').setDescription('保存为的歌单名').setRequired(true)),
  new SlashCommandBuilder().setName('msr_load').setDescription('加载指定歌单')
  .addStringOption(opt => opt.setName('name').setDescription('要加载的歌单名').setRequired(true)),
  new SlashCommandBuilder().setName('msr_remove').setDescription('移除列队中的指定音源').addIntegerOption(opt => opt.setName('index').setDescription('音源编号').setRequired(true)),
  new SlashCommandBuilder().setName('msr_listloop').setDescription('切换列表循环'),
  new SlashCommandBuilder().setName('msr_now').setDescription('显示当前播放的音源链接'),
  new SlashCommandBuilder().setName('msr_listplaylists').setDescription('列出所有保存的歌单'),
  new SlashCommandBuilder().setName('msr_delete').setDescription('删除指定名称的歌单')
  .addStringOption(opt => opt.setName('name').setDescription('歌单名称').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );  
  console.log('✅ 塞壬唱片MSR指令已部署');
})();

client.on('interactionCreate', async interaction => {
  
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;
  await interaction.deferReply();

  lastUsedChannel = interaction.channel;
  if (!lastUsedChannel) console.log('⚠️ 无法发送播放完提示：没有找到最近使用的文字频道');

  if (name === 'msr_join') {
    const member = interaction.member;
    const channel = member.voice.channel;
    if (!channel) return interaction.followUp('⚠️ 博士，您还没有链接到语音频道。');
    if (!connection) {
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      connection.subscribe(player);
    }
    return interaction.followUp('📡 【通讯接入】塞壬唱片已进入语音频道，等待调度指令。');
  }

  
  if (name === 'msr_call') {
    const rawInput = interaction.options.getString('url');
    const url = extractURL(rawInput);

    if (!url) return interaction.followUp('❌ 音源读取失败，请检查链接格式。');

    const member = interaction.member;
    const channel = member.voice.channel;
    if (!channel) return interaction.followUp('⚠️ 博士，请先连接至语音频道。');
    
    if (!connection) {
      connection = joinVoiceChannel({ 
        channelId: channel.id, 
        guildId: interaction.guild.id, 
        adapterCreator: interaction.guild.voiceAdapterCreator 
      });
      connection.subscribe(player);
    }

    queue.push(url);
    console.log(`🧭 当前索引：${currentIndex}，队列长度：${queue.length}，单曲循环：${isLooping}，列表循环：${isListLooping}`);


    if (player.state.status !== AudioPlayerStatus.Playing) {
      currentIndex = queue.length - 1;
      await playCurrent(interaction);
    } else {
      interaction.followUp(`📥 任务已接收：音源已调度至第 ${queue.length} 位。\n🔗 链接：${url}`);
    }
    console.log(`[CALL] 用户 ${interaction.user.tag} 添加了音源：${url}`);
  }

  if (name === 'msr_suspend') player.pause() && interaction.followUp('⏸️ 【调度中止】等待您的指挥。');
  if (name === 'msr_resume') player.unpause() && interaction.followUp('▶️ 【恢复调度】博士，我在听。');



  if (name === 'msr_skip') {
    if (currentIndex + 1 >= queue.length) {
      if (isListLooping && queue.length > 0) {
        currentIndex = 0;
        interaction.followUp(`🔁 已循环回到第 1 首音源`);
        player.stop(); // Idle中处理播放
      } else {
        interaction.followUp('⏹️ 跳过失败：已经是最后一首，且未开启列表循环');
        if (lastUsedChannel) {
          lastUsedChannel.send(
            '📭【作战终结】任务列队已调度完毕。\n📌 若需继续执行，请使用 `/msr_listloop` 启动轮转调度。'
          );
        }
      }
    } else {
      interaction.followUp(`⏭️ 音源切换中……（索引位置：${currentIndex + 1}）`);
      skipRequested = true;
      player.stop();
    }
  }
  
  

if (name === 'msr_leave') {
  cleanUp();
  interaction.followUp('👋 【通讯断开】塞壬唱片已退出语音频道，并完成资源清理。');
}



  if (name === 'msr_queue') {
    if (!queue.length) return interaction.followUp('📭 当前列队为空。');
    const list = queue.map((url, i) => `${i === currentIndex ? '🎶' : ''} [${i + 1}] ${url}`).join('\n');
    interaction.followUp(`📋 【调度队列】当前任务如下：\n${list}`);
  }

  if (name === 'msr_loop') {
    isLooping = !isLooping;
    console.log(`[LOOP] 单曲循环状态：${isLooping}`);
    interaction.followUp(`🔂 【循环设定】博士 单曲循环已${isLooping ? '开启' : '关闭'}。`);
  }

  if (name === 'msr_listloop') {
    isListLooping = !isListLooping;
    console.log(`[LIST LOOP] 列表循环状态：${isListLooping}`);
    interaction.followUp(`🔁 【循环设定】博士 列表循环已${isListLooping ? '开启' : '关闭'}。`);
  
    // 🆕 如果播放停止状态且开启了循环，则立即播放第一首
    if (isListLooping && player.state.status !== AudioPlayerStatus.Playing && queue.length > 0) {
      currentIndex = 0;
      lastUsedChannel = interaction.channel; 
      await playCurrent(interaction);
      console.log('[提醒] 播放结束，提示用户开启列表循环');
    }
  }
  

  if (name === 'msr_randomize') {
    const current = queue[currentIndex];
    queue = queue.slice(currentIndex + 1).sort(() => Math.random() - 0.5);
    queue.unshift(current);
    currentIndex = 0;
    interaction.followUp('🔀 已重构列队顺序。');
  }

  if (name === 'msr_abort') {
    queue = [];
    currentIndex = 0;
    isLooping = false;
    if (connection) connection.destroy(), connection = null;
    player.stop();
    interaction.followUp('🛑 【作战结束】当前音源与队列已清空，终端已重置。');
  }

  if (name === 'msr_id') {
    if (!queue.length) return interaction.followUp('📭 当前列队为空。');
    interaction.followUp(`🧾 【当前编号】第 ${currentIndex + 1} 首音源`);
  }

  if (name === 'msr_now') {
    if (!queue.length) return interaction.followUp('📭 当前列队为空。');
    interaction.followUp(`🎧 当前播放音源：${queue[currentIndex]}`);
  }

  if (name === 'msr_save') {
    const pname = interaction.options.getString('name');
    const filePath = path.join(playlistsDir, `${pname}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(queue, null, 2));
      interaction.followUp(`💾 【数据封装】歌单 **${pname}** 已成功保存。`);
    } catch {
      interaction.followUp('❌ 歌单保存失败，请检查权限或路径');
    }
  }
  

  if (name === 'msr_load') {
    const pname = interaction.options.getString('name');
    const filePath = path.join(playlistsDir, `${pname}.json`);
    try {
      const data = fs.readFileSync(filePath);
      queue = JSON.parse(data);
      currentIndex = 0;
  
      const member = interaction.member;
      const channel = member.voice.channel;
      if (!channel) return interaction.followUp('⚠️ 请先加入语音频道再加载歌单');
  
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator
        });
        connection.subscribe(player);
      }
  
      interaction.followUp(`📂 【数据解封】歌单 **${pname}** 已加载完毕，准备执行。`);
      if (queue.length) await playCurrent(interaction);
    } catch {
      interaction.followUp(`❌ 歌单 **${pname}** 加载失败，请检查是否存在`);
    }
  }
  
  if (name === 'msr_listplaylists') {
    try {
      const files = fs.readdirSync(playlistsDir).filter(file => file.endsWith('.json'));
      if (!files.length) return interaction.followUp('📭 暂无保存的歌单');
      const names = files.map(f => '🎼 ' + f.replace('.json', '')).join('\n');
      interaction.followUp(`🎵 【作战记录】\n${names}`);
    } catch {
      interaction.followUp('❌ 读取歌单目录失败');
    }
  }
  
  if (name === 'msr_delete') {
    const pname = interaction.options.getString('name');
    const filePath = path.join(playlistsDir, `${pname}.json`);
    try {
      fs.unlinkSync(filePath);
      interaction.followUp(`🗑️ 【数据销毁】歌单 **${pname}** 已被移除。`);
    } catch {
      interaction.followUp(`❌ 删除失败，歌单 **${pname}** 不存在`);
    }
  }
  

  if (name === 'msr_remove') {
    const index = interaction.options.getInteger('index') - 1;
    if (index < 0 || index >= queue.length) return interaction.followUp('❌ 音源编号无效。');
    const removed = queue.splice(index, 1);
    if (index <= currentIndex && currentIndex > 0) currentIndex--;
    interaction.followUp(`🗑️ 【移除完毕】已清除第 ${index + 1} 项音源：\n🔗 ${removed[0]}`);
  }
});

client.once('ready', () => {
  cleanUp(); // 启动时先清空状态
  console.log(`🎧 塞壬唱片MSR 终端已上线 听从您的指挥 博士：${client.user.tag}`);
});


client.login(TOKEN);

