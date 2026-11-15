# 产品规格索引

更新时间：2026-11-03。职责：按领域定位“应该怎样”。复用原 [product.md](../../BilingualAuditor-docs/docs/product.md) 为规格唯一正文，不为了目录形状拆出重复条款；[decisions.md](../../BilingualAuditor-docs/docs/decisions.md) 为人工选择与建议的区分依据。

| 产品领域 | 规格位置 | 相关决定 | 开发时追加读取 |
| --- | --- | --- | --- |
| TXT 输入、对照阅读、混合翻译 | product §4.1、§6 | D01、D09、D10 | [架构](../../ARCHITECTURE.md)、[UI](../FRONTEND.md)、[可靠性](../RELIABILITY.md) |
| 中/英文朗读与口音 | product §4.1、§4.5 | C02、D09 | [安全](../SECURITY.md)、[候选初评](../../BilingualAuditor-docs/docs/technical-evaluation.md)；设备引擎另验 |
| 查词、词卡、自动推荐 | product §4.2、§4.3 | D02、D03、D07 | 许可及首次查询与已保存释义的离线边界 |
| FSRS 复习 | product §4.4 | D04 | 完整调度状态、日志、库版本与离线恢复 |
| 历史、设置与手动备份 | product §4.5、§4.6、§4.8 | D05、D08 | 导入覆盖方案仍是建议；实施前明确数据合同 |
| 分享与试用费用 | product §4.7、§5 | D06 | [SECURITY](../SECURITY.md)、服务商独立免费条件 |
| 应用图标 | product §2、decisions D11 | D11 | [DESIGN](../DESIGN.md) |

这张表是定位表，不是实现状态表；实际能力只查 [current-state](../product/current-state.md)。新领域足够复杂时可独立成文，但先明确原条款如何转为链接，禁止同一规则两处维护。
