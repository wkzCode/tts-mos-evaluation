# AISHELL-3 真人语音子集

本目录的真人语音来自北京希尔贝壳科技有限公司（Beijing Shell Shell Technology Co., Ltd.）公开发布的 AISHELL-3，按 Apache License 2.0 再分发。许可全文见同目录 `LICENSE-Apache-2.0.txt`。

- 原始数据及许可说明：[OpenSLR SLR93](https://www.openslr.org/93/)
- 发布方数据页面：[AISHELL-3](https://www.aishelltech.com/aishell_3)
- 实际获取的逐条音频及转写：[AISHELL/AISHELL-3](https://huggingface.co/datasets/AISHELL/AISHELL-3)
- 获取日期：2026-10-24。全部 Hugging Face 数据请求通过 `https://hf-mirror.com` 镜像，下载过程设置 `HF_ENDPOINT=https://hf-mirror.com`。
- 论文：Yao Shi, Hui Bu, Xin Xu, Shaoji Zhang, Ming Li. *AISHELL-3: A Multi-Speaker Mandarin TTS Corpus*. Interspeech 2021, pp. 2756–2760. DOI：[10.21437/Interspeech.2021-755](https://doi.org/10.21437/Interspeech.2021-755)。

## 本子集

统一说话人 **SSB0534**。官方 `spk-info.txt` 标注为 female、C（26–40岁）、north。原始数据以匿名说话人编号提供，没有将其标识为公众人物；本子集不推断或公开其真实身份。

20 条正式测试句、2 条练习句和1条独立参考句互不重叠。参考录音 `SSB05340021.wav` 时长约5.013秒，原文为“距离二零二二年冬奥会举办还有不到七年时间”。所有真人音频是对应源 WAV 的原样复制，未拼接、未合成、未变声。原始格式为44.1 kHz、单声道、16-bit PCM。用于模型的采样率转换属于模型准备步骤，应由使用方另外记录。

每项 `source_id` 对应官方文件名，`source_url` 为原始仓库文件位置；`text` 从 `train/content.txt` 移除交替排列的拼音后逐字保留汉字，再增加句末及必要的句内标点。数字保留官方汉字读法。没有添加源录音未读出的实词。文件名与官方转写逐项对应，已验证WAV可以解码、时长有效且不是静音；未声称进行了人工逐字听审。

这是公开语料构成的固定试测集。不能据此宣称各合成模型从未在训练时见过这些文本或音频，也不应把该试测得分泛化为模型对所有中文场景的客观排名。

若将真人音频纳入网页发布，请一并保留此来源声明和 Apache 2.0 许可证。合成音频来自各自模型，应单独标明，不属于本目录所标记的真人录音。
