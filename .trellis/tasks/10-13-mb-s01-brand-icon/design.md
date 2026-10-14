# S01 资产设计

遵循父visual-design第7节，A以书签为主、负空间桥接为辅，B以两书签相接形成M作对照。外部产品图标不作为复制目标。

## 生成规范

- 表达：个人书签与本地工作台相连，不暗示新增云同步。
- 文字：无文字、无字母标语。
- 用途：正方形高分辨率PNG母版，Windows任务栏/侧栏/Chrome最小16px。
- 色数：最多3，#1767D2、较深蓝、白；外围真实透明，蓝色主体可有内部实底。
- 参考：父任务现有蓝色工作台，仅作背景/色系参考，不要求保留绿色旧图。
- 排除：霓虹渐变、AI星芒、Chrome彩环、写实桥索、3D、文字、水印、外阴影、白matte。

提示词A建议：
“Use case: logo-brand. Create a single app icon for Markbridge, a local-first Chrome bookmark workspace. A compact blue bookmark silhouette with one simple bridge-like negative-space connection inside, subtly suggesting an M. Bookmark first, bridge second. Flat, deliberate geometry and broad readable shapes. At most blue #1767D2, darker blue and white. Square canvas, generous optical inset, truly transparent outside the mark. Legible at 16 pixels. No text, lettering, Chrome logo, cloud, sparkles, gradients, glow, 3D, thin cables, mockup background or watermark.”

B只改变符号构成：“two abstract bookmark ribbons joined across the top to form a compact M and bridge span”，其余约束相同。内置工具transparent_background=true；从零生成不传编辑目标。输出先视检及alpha检查；需要重绘/去底必须用图像编辑工具，不用Python绘图替代。

## 路径与派生

候选及prompt/比较证据存本子任务assets/evidence。选定母版复制至assets/brand/markbridge-master.png；应用品牌消费apps/desktop本地资产，Windows消费src-tauri/icons/icon.png及icon.ico，扩展public/icons按16/32/48/128派生。

用已安装Tauri icon命令在任务内临时输出，仅复制需要的Windows结果。调整尺寸/封装ICO属于格式派生，不能改变已选构图。若16px失真，针对形状粗细/负空间做明确生成修订后再派生。新增二进制资源如触发check-artifacts，仅修准确的文件分类，保留既有文本安全检查，不预先改脚本。

## 回滚

保留旧图标的Git依据；同次恢复母版消费引用及资源，禁止删除用户其他改动。Windows缓存问题记录在证据，不清系统缓存或改日常快捷方式。
