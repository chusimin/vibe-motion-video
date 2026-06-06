# Showreel 音频拆解沉淀(7 条)

来源:用户 `build_audio_breakdown.py` 拆解 → BPM/能量/拍点/风格/生成提示词。提炼后落 `presets/audio/showreel.json`。

## 实测数据
| 片 | BPM(置信) | 拍/s | RMS dBFS | 备注 |
|---|---|---|---|---|
| ARIA | 148(0.60) | 2.85 | -16.7 | up-tempo,品牌揭示 |
| Aftermagics #1 | 112.5(0.84) | 4.27 | -10.8 | 高置信,密打击 |
| Aftermagics brand | 112.5(0.83) | 4.42 | -12.2 | 高置信 |
| Bohdan | 104(0.67) | 3.71 | -9.5 | montage,响 |
| ObiN | 91(0.62) | 2.17 | -9.5 | 克制编辑 |
| Varchasva client | 122(0.46) | 3.63 | -28.6 | 轻 |
| Varchasva ChatGPT | 95(0.23) | 3.22 | -27.5 | 极简 |

## 提炼(进 presets/audio/showreel.json)
- **BPM**:90-148,快 montage 偏高;showreel 默认 ~124,高潮 140-150。
- **风格**:modern motion design / clean editorial tech brand / minimal premium / glossy synth / busy percussion grid / fast sync points。**无人声、无旋律抄袭、无电影管弦、无长 ambient 前奏**。
- **3 个鼓点变体**:A 紧凑切分 / B halftime 更重更稀 / C broken-beat 更碎。
- **卡点**:剪辑切点落在每 2 拍/4 拍;124BPM 每拍 0.48s,1-1.2s/镜≈每 2-3 拍切——**和快节奏规则天然咬合**。
- **响度**:premium 片 RMS -10~-17;成片 -14 LUFS,音乐床 -20、duck 到 VO 下 ~9dB。

## 怎么用
- 生成 BGM:`vibemotion music prompt` → 出可投喂 Suno/Udio 的提示词。
- 卡点:`vibemotion music sync <曲>` → 检测拍点,把 scene 边界吸到最近拍。
- 想拆新音频:`vibemotion teardown` 的音频 pass(BPM/hits/波形/提示词)。
