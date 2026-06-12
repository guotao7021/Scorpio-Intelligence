# A股本地化投研与市场认知系统

## Public Hub

- Product site: [docs/public/index.html](docs/public/index.html)
- Chinese site: [docs/public/index-cn.html](docs/public/index-cn.html)
- English site: [docs/public/index-en.html](docs/public/index-en.html)
- Changelog CN: [docs/public/changelog-cn.html](docs/public/changelog-cn.html)
- Changelog EN: [docs/public/changelog-en.html](docs/public/changelog-en.html)
- Feedback: [docs/public/feedback.html](docs/public/feedback.html)
- Roadmap: [docs/public/roadmap.html](docs/public/roadmap.html)
- FAQ: [docs/public/faq.html](docs/public/faq.html)

本项目是一个基于 Python、PyQt5、SQLite 和本地数据流水线的 A 股投研辅助系统。系统面向本地化研究、策略验证、数据可用性治理、AI 解释辅助和商业版本发行边界管理。

重要边界：本系统仅用于数据分析、策略研究、回测验证、风险复核和报告归档。系统输出不构成投资建议、收益承诺或交易指令。历史回测、历史收益、模型评分和 AI 解释均不代表未来收益。用户应独立判断并自行承担投资风险。

## 当前定位

系统不是“荐股软件”或“自动赚钱软件”，而是投研工作台：

1. 聚合行情、财务、资金流、板块、情绪和本地缓存数据。
2. 对单票、市场、策略、风险和数据质量进行结构化分析。
3. 通过 Market Cognition OS、KGProfile 和诊断本体输出证据链解释。
4. 通过 P2 数据可用性总控、ETL 任务和修复计划降低数据不确定性。
5. 通过商业 edition 矩阵控制个人版、团队版和企业私有化版的交付边界。

### 当前工作台边界

桌面端当前采用两个独立工作台入口：

1. `标的研究工作台`：面向单个股票的研究。前台导航只保留 `标的研究` 和 `设置/授权`。行情图、技术面、基本面、财报、资讯、研究结论、大盘、行业、主力资金、持仓观察等作为个股研究证据链展示；市场、行业、资金是个股研究上下文，不是独立策略流程。
2. `策略流程工作台`：承载目标设定、自动/参考选股、策略验证、信号中心、风险监控、交易工作流、数据中心、任务中心、环境诊断等流程化能力。

标的研究工作台不得引入策略验证、风险复核、数据中心、本体/认知、自动化生产等顶层模块；这些能力只在策略流程、自用内部能力或团队/企业治理边界内出现。

## 版本差异

当前采用“单主线 + 产品矩阵 + 差异化发行产物”策略。`master` 是唯一技术主线，`release/*` 只作为发行快照或历史迁移分支。

| Edition | 定位 | 保留能力 | 不交付或默认关闭 |
| --- | --- | --- | --- |
| `self_use` 自用完整版 | 研发母版和个人主控端 | 完整研究入口、内部数据中心、Market Cognition OS、KGProfile、开发诊断 | 不作为正式对外销售版 |
| `personal_standard` 个人标准版 | 低价入门版 | 单票分析、市场分析、观察名单、基础回测、数据健康、报告导出 | 参数优化、多因子专业能力、AI 高级解释、Agent/Skill、内部数据中心、实盘接口 |
| `personal_pro` 个人专业版 | 首个可销售个人版 | 单票分析、市场分析、回测、多因子分析、AI 单票解释、参数验证摘要、商业结果包导入 | 完整 Market Cognition OS、Agent/Skill 编排、内部模型参数、内部数据中心、实盘接口 |
| `team` 小团队版 | 多人协作和投研复用 | 团队空间、共享观察名单、报告归档、RBAC、任务队列、Agent 控制台 | 完整细粒度 Market Cognition OS、内部模型参数、默认实盘接口 |
| `enterprise` 企业私有化版 | 合同制私有化交付 | 企业审计、权限治理、数据授权状态、部署文档、备份恢复、合同功能开关 | 未授权免费数据源 SLA、默认实盘交易、收益承诺 |

版本边界代码源：

```text
commercial/edition_config.py
commercial/feature_flags.py
commercial/product_matrix.py
commercial/module_boundary.py
commercial/plan_limits.py
```

## 核心模块

```text
ui/          PyQt5 桌面界面和工作台页面
analysis/    评分、信号、回测、市场认知、风险和策略解释
data/        SQLite、本地缓存、数据源、ETL 和数据可用性治理
ai/          AI 解释辅助、提示词、Agent/Skill 和本体上下文
workers/     后台任务、数据同步、模型和交易流程适配
commercial/  edition、feature flags、产品矩阵、包边界和计划额度
scripts/     商业发行、数据包、授权、迁移和回归脚本
tests/       单元、边界、商业发行和端到端回归测试
docs/        产品、架构、合规、商业化和系统治理文档
```

## 快速开始

推荐 Python 版本：`3.12`。本地测试环境使用：

```powershell
C:\Python312\python.exe -m pytest -q
```

安装依赖：

```powershell
C:\Python312\python.exe -m pip install -r requirements.txt
```

启动默认应用：

```powershell
C:\Python312\python.exe main.py
```

按 edition 启动：

```powershell
.\scripts\start_edition.ps1 -Edition self_use -Mode launcher -Python C:\Python312\python.exe
.\scripts\start_edition.ps1 -Edition personal_pro -Mode stock -Python C:\Python312\python.exe
.\scripts\start_edition.ps1 -Edition personal_standard -Mode stock -Python C:\Python312\python.exe
.\scripts\start_edition.ps1 -Edition team -Mode quant -Python C:\Python312\python.exe
```

## 商业发行检查

生成商业发行矩阵、边界报告和 smoke 报告：

```powershell
C:\Python312\python.exe scripts\build_commercial_release_matrix.py --output-dir build\commercial_release_matrix
```

执行临时包目录物化、裁剪、复审和核心页面模块加载：

```powershell
C:\Python312\python.exe scripts\build_commercial_release_matrix.py --materialize-package --prune-package --load-pages --output-dir build\commercial_release_matrix
```

CI 配置：

```text
.github/workflows/commercial-release.yml
```

## 数据源与授权边界

系统可接入 AkShare、Baostock、Tushare、BigQuant、腾讯、新浪、东方财富、本地 SQLite、Kuzu 等数据或存储能力。商业交付前必须区分：

1. 可随包交付的演示数据。
2. 用户自有 Token 或用户自配的数据源。
3. 需要商业授权的数据源。
4. 不得作为 SLA 承诺的免费或非稳定接口。

商业版本不得把未授权免费数据源包装成企业级稳定服务。

## 测试与质量

常用检查：

```powershell
C:\Python312\python.exe -m pytest -q
C:\Python312\python.exe tools\scan_doc_mojibake.py
git diff --check
```

商业边界专项：

```powershell
C:\Python312\python.exe -m pytest tests\test_commercial_product_matrix.py tests\test_commercial_release_matrix_build.py tests\test_commercial_module_boundary.py tests\test_team_commercial_asset_boundary.py -q
```

## 文档入口

1. [文档中心](docs/README.md)
2. [商业化文档索引](docs/COMMERCIALIZATION_DOCS_INDEX.md)
3. [商业销售说明](docs/COMMERCIAL_SALES_BRIEF.md)
4. [版本分支与产品收敛规范](docs/VERSION_BRANCHING_AND_PRODUCT_CONVERGENCE.md)
5. [合规性升级落地说明](docs/COMPLIANCE_IMPLEMENTATION_GUIDE.md)

## 许可证与合规

仓库内代码许可证以 `LICENSE` 文件为准。第三方数据源、模型服务、行情接口和商业数据包不因本仓库许可证自动获得商业分发授权。

任何对外销售、演示、报告导出或客户交付材料都必须保留非投资建议声明、数据来源说明、生成时间、版本信息和风险提示。
