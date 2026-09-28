# Archi 使用指南（繁體中文）

[English guide](adoption-guide.md)

Archi 將「原始碼／Helm 靜態分析」、「Kubernetes 部署擷取」與「實際流量證據」分開呈現，協助你理解服務關係及部署狀態。它不是 CD 部署工具，也不會因為版本不同就判定部署錯誤。

## 1. 先選對畫面

| 畫面 | 用途 | 資料性質 |
| --- | --- | --- |
| Architecture demo | 熟悉架構圖與服務模型 | 虛構示範，不是你必須採用的 Helm 格式 |
| Project analysis | 檢視原始碼、Helm 分析，以及附加的 Runtime／流量證據 | 依輸入決定；請確認是否為 simulation |
| Deployment scenarios | 練習比較不同 CD 階段，或開啟 acceptance bundle | 內建情境是模擬資料；匯入 bundle 依其輸入模式 |

每頁的 **How to use** 可開啟六步驟動畫導覽，支援播放、暫停、上／下一步、鍵盤關閉，以及減少動態效果。

**Project analysis** 上方的 **Data sources and timestamps** 集中顯示三種資料：Source／Helm 的分析評估時間、每個 Runtime cluster 的擷取區間與是否過期，以及 Traffic 的觀察區間。Source 的評估時間不是部署擷取時間；Traffic 尚無 freshness 規則，不能視為即時資料。

Runtime 的 **Setup checklist** 會列出 baseline、server target、環境 target 與 namespace 綁定範圍。這些檢查不會連 Kubernetes，也不代表 credentials 或 RBAC 已驗證。**Recovery options** 收納重新載入操作，失敗時自動展開並建議下一步。畫面內的中英文設定指南會開啟 GitHub，需要 repository 存取權限。

Runtime 表格預設四欄；勾選 **Show comparison columns** 可展開 presence、image references 與 assessment，點 workload 則可查看完整詳細資料。Controller failure 與待確認提示不會因為精簡表格而隱藏，版本差異本身也不會標成錯誤。

Project analysis 的 tabs 支援鍵盤：Tab 進入目前選取的 tab，左右方向鍵循環切換，Home／End 到第一／最後一項，再按 Tab 進入對應 panel。這些操作不會擷取資料。**How to use** 會依開啟時的畫面與狀態提供情境提示，再接原有六步驟導覽；Escape 關閉後焦點回到導覽按鈕。

## 2. 把既有 Helm 與專案接進來

### 不需要把公司的 chart 改成 demo 格式

Archi 先呼叫 Helm，使用指定 chart 與依序排列的 values files 產生 Kubernetes resources，再分析結果。它不要求固定的 `.Values.services` 或 `.Values.image` 結構。

| 你的資料 | 對應設定 |
| --- | --- |
| 本地 source／config repositories | `repositories[]`：根目錄與精確 commit SHA |
| 專案及邏輯服務歸屬 | `projects[]`、`services[]` |
| 既有 chart 目錄 | `environments[].releases[].chart` |
| CD 使用的 values files 及覆蓋順序 | `environments[].releases[].values[]` |
| Release、cluster、namespace | 每個 environment 的 release scope |
| Rendered Deployment／Service | Instance 的 `workload`／`endpoint` bindings |
| Java client 建立方式與 properties | Source adapter 輸入，以及 instance 的 property／profile policy |

完整欄位請看 [model-composition.md](model-composition.md)。新增另一個環境時，明確設定該環境的 releases、instances、namespaces、values、profiles 與 properties；不要從 branch 名稱猜環境。

目前一份 system manifest 使用同一組 repository revisions。如果 QA 與 production 要分析不同的 source／config commits，請使用不同 manifests。

下例只是 release 片段，**不是可直接執行的完整 system manifest**：

```json
{
  "id": "orders-qa", "cluster": "commerce", "namespace": "sales-qa",
  "name": "orders", "adapter": "helm-template/1",
  "chart": {"repository": "deploy", "path": "helm/orders"},
  "values": [
    {"repository": "deploy", "path": "values/common.yaml"},
    {"repository": "deploy", "path": "values/qa.yaml"}
  ],
  "helmVersion": "v3.17.3", "kubeVersion": "1.30.0", "apiVersions": []
}
```

請使用實際 CD rendering context 的 capabilities。真實輸入的 system manifest 必須設定 `simulation: false`；舊版 single-repository simulation config 與 v1 generator 仍僅供模擬。不能只修改 fixture 的標記，就將它當成真實資料。

### 執行靜態分析

先準備 Node.js 22+、已核准的本地 repositories，以及 Helm v3.17.3。以下指令在 Archi repo 根目錄執行；所有示範路徑都需替換：

```bash
npm ci --ignore-scripts
# 另行安裝 Helm v3.17.3，並確認 helm 位於 PATH。
npm run analyze -- --root /approved/workspace --system system.json \
  --out /path/to/archi/artifacts/analysis
npm run dev
# 開啟 http://127.0.0.1:4173/?view=analysis
```

`--root` 是分析輸入的 workspace；`--out` 指向目前啟動 UI 的 Archi repo 內 `artifacts/analysis`。分析成功不代表已連線 Kubernetes，也不代表已取得實際流量。

### 接入前先確認限制

- 靜態 inventory 目前解讀 Deployment、Service、ConfigMap。不支援的 kinds／hooks 會留下 diagnostics；Ingress、mesh routes、operators、StatefulSets、Jobs 不能只靠改欄位名稱就支援。
- Render 介面提供 values files，不接受任意 Helm CLI arguments。`--set`、Argo CD overrides、Helmfile、plugins、post-renderers、外部 secrets 都需要另外確認；缺少這些輸入時，不能宣稱與 CD 結果等價。
- Chart dependencies 必須已包含在核准的輸入內，不會自動下載遠端 dependencies。二進位打包 dependencies 與文字型 Git capture 的相容性也需要驗證。
- 本地 render 沒有 live `lookup` 結果；若隨機值或時間讓兩次 render 不一致，分析會拒絕該輸入。
- Source adapter 目前支援有限、明確的 Java Spring bean patterns。Kotlin／gRPC 或動態 client factories 可能需要新 adapter；Helm 能 render 不等於能完整找出所有服務關係。

評估新專案時，先提供去識別化的 chart 目錄、代表性 values、實際 CD render 指令／overrides，以及 rendered Deployment／Service 範例，即可區分「設定映射」與「需要擴充 parser」的問題。這一步不需要 cluster credentials 或 secrets。

## 3. Runtime：按下按鈕才擷取

Runtime collector 透過 `kubectl`，對明確指定的 namespaces 分頁讀取 Deployments、ReplicaSets、Pods，僅保留允許的欄位，產生一次性 capture。

**開頁面、換 tab、切換環境或更新資料新鮮度提示，都不會擷取 inventory。只有按下 Refresh runtime 才會執行。** 目前沒有 polling、WATCH、SSE 或 WebSocket，也沒有自動重試。

### 設定 Refresh runtime 按鈕

以 [refresh-config.json](../examples/runtime/refresh-config.json) 為範本，建立 `config/runtime-refresh.local.json`（此路徑已被 Git 忽略）。填入核准的 context、kubeconfig 絕對路徑，以及實際 scope：

```json
{
  "schemaVersion": "archi/runtime-refresh-v1alpha1",
  "targets": [
    {
      "id": "commerce-qa",
      "environment": "qa",
      "cluster": "commerce",
      "context": "REPLACE_WITH_APPROVED_CONTEXT",
      "kubeconfig": "/REPLACE_WITH_APPROVED_PATH/kubeconfig",
      "namespaces": ["experience-qa", "sales-qa", "stock-qa", "sandbox-qa"]
    }
  ]
}
```

- `environment`／`cluster` 必須對應分析中的 scope；cluster ID 是操作者指定的識別，不是自動驗證的 cluster 身分。
- `namespaces` 必須涵蓋該 environment／cluster 所有已綁定 instances 的 namespaces。
- 每個 environment／cluster 只能設定一個 target。瀏覽器不能自行輸入 context、credential path、namespace、URL 或執行指令。
- 執行 Archi 的機器需有 `kubectl`、可用的 credentials，以及 namespace 範圍的唯讀 RBAC。完整權限與 CLI capture／import 指令請看 [runtime-enrichment.md](runtime-enrichment.md)。
- 不要提交 credentials；只使用可信任的 kubeconfig，因為 credential plugins 會以啟動 server 的使用者權限執行。

```bash
npm run dev -- --runtime-config config/runtime-refresh.local.json
```

設定在 server 啟動時讀入；修改檔案後必須重啟。接著：

1. 開啟 `http://127.0.0.1:4173/?view=analysis`，選擇環境。
2. 進入 **Runtime inventory**，確認 target 與 namespace scope。
3. 按 **Refresh runtime**，等待結果；期間不能重複提交。
4. 成功後查看擷取時間、inventory 與服務詳細資料；graph 與 export 也使用更新後的共同資料。

未設定時按鈕仍可見，但停用並顯示設定提示。Synthetic analysis 不會啟用真實 cluster 擷取，必須先完成經確認的真實輸入分析。Production 若沒有 inventory 權限，可以不設定 target，繼續使用靜態分析；缺少 Runtime 證據應維持 unknown。

### 失敗或 timeout 時怎麼做？

| 情況 | 行為／處理方式 |
| --- | --- |
| 擷取成功且完整 | 更新該 environment／cluster 的 Runtime overlay；不改寫 source／Helm 或 traffic 資料 |
| 擷取不完整或權限不足 | 封存 partial capture，但不取代舊 overlay；畫面保留原資料與時間 |
| 擷取中 source baseline 改變 | 拒絕發布到不同 baseline；先重新載入分析再重試 |
| Server 重啟、token 失效 | 按 **Reload setup** 重新取得設定資訊；不會擷取 cluster |
| Timeout／斷線、不確定是否成功 | 先按 **Reload stored analysis** 確認已保存結果，再決定是否重試；此按鈕不會擷取 cluster |

Collector 的時間預算為 120 秒，API 於 125 秒取消，UI 於 135 秒逾時。一次 refresh 的 HTTP request 會保持開啟，直到擷取與原子發布完成；不是背景訂閱。每個本地 server 同時只允許一次 refresh。

斷線會盡可能取消尚未完成的 kubectl 工作，但已進入提交階段的發布仍可能完成，因此不能把 timeout 解讀為「後端一定沒存檔」。

Capture 封存在 `artifacts/runtime-captures/`，新檔案僅擁有者可存取；目前由使用者自行管理保存期限。

### 如何解讀結果？

詳細資料將三種狀態分開：選定 repository 的 render、擷取時 Deployment 的 workload spec，以及觀察到的 Pods。

- 版本不同、混合 Pod 版本、rollback 或不同 CD 時序，本身都是資訊，不是錯誤。
- `reported-failure` 需要明確的 controller failure 證據；不會僅憑差異推斷 Helm 寫錯。
- `no-discrepancy-detected` 只代表有限的一致性檢查未發現差異，不代表端到端應用正確。
- 資料是擷取當下的觀察；不同 resource lists 並非同一個原子快照，過期資料仍需留意。
- Pods inventory 不等於實際服務流量。流量證據仍來自獨立的 Istio／OTel 輸入。

**安全邊界：** 這是 localhost、單一使用者的工作站功能。雖有 Host／Origin 檢查與每次 server 啟動產生的 request token，但沒有使用者登入或多租戶授權。不要透過 network bind、proxy 或 port forwarding 將它當成團隊共用服務。

## 4. 不連 cluster，也能練習 CD 情境

```bash
mkdir -p artifacts/acceptance
npm run runtime:acceptance -- --scenarios --out artifacts/acceptance/bundle.json
npm run runtime:acceptance -- --verify artifacts/acceptance/bundle.json
npm run dev
# 開啟 http://127.0.0.1:4173/?view=acceptance
```

這會建立模擬情境 bundle，供離線學習與驗收流程使用。輸出若已存在，指令會拒絕覆蓋；請保留舊證據，換新路徑輸出，再用 **Open bundle** 開啟。

瀏覽器開啟 bundle 不會上傳檔案，會檢查 hashes 並顯示已保存 reports。CLI `--verify` 會重新執行 reconciliation，並獨立檢查維護中的 T0–T6 oracle。

也可將核准的真實或模擬輸入打包，保留原分析的 input mode：

```bash
npm run runtime:acceptance -- --analysis PATH_TO_ANALYSIS.json \
  --capture BEFORE.json --capture AFTER.json --at 2026-09-26T12:00:00Z \
  --out NEW_BUNDLE.json
npm run runtime:acceptance -- --verify NEW_BUNDLE.json
```

路徑與 `--at` 都要替換，時間需使用實際 assessment time。自行擷取的資料沒有獨立 oracle，會顯示 `not-provided`，不會自動視為驗收通過。

Replay 需要相同的 Runtime source files、package-lock 與已安裝 dependencies，不需要 live cluster、Helm 或原始 source repositories。Bundle 可能包含敏感名稱／設定，分享前請審查並保護；hashes 只能檢查內容一致性，不證明來源真實性。

僅在相同 environment／cluster／input mode 內比較 captures。某個 finding 消失可能只是覆蓋範圍不同，不代表資源已刪除；UID 改變則可識別資源重建。

## 5. 常見卡關與下一步

| 問題 | 先檢查 |
| --- | --- |
| 畫面仍是舊分析 | `--out` 是否指向目前 server 的 `artifacts/analysis`；重新載入已保存分析 |
| Refresh runtime 無法按 | 是否提供 `--runtime-config`、是否為真實 baseline、目前環境有無 target、namespace 是否完整 |
| Helm 可 render，卻找不到服務關係 | Source pattern 是否在 adapter 支援範圍；確認 instance bindings 與 diagnostics |
| 公司 CD 和本地結果不同 | Values 順序、capabilities、overrides、dependencies、post-renderers 是否一致 |
| Production 不允許連線 | 保留靜態分析；不要將未知狀態當成 absent 或成功 |

建議先選一個可讀取的 QA 環境，完成「靜態分析 → 手動 Refresh runtime → 檢查 scope／時間／證據 → 匯出 review」流程，再增加其他環境。真實 cluster 連線、RBAC 與部署端到端驗證仍需在你的環境實測；模擬情境或 CI 通過不能取代這些驗證。
