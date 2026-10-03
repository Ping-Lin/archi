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

### 補充：不同專案的 client 寫法

現在可為個別 service 選擇 `ai-evidence/1` adapter。AI 依 template 填入 client、endpoint 設定 key、條件及 source 引用，再交由既有分析流程處理。它不會直接呼叫外部 AI，也不會自動核准語意。未審核／拒絕的候選即使能對到目標，也不會產生 dependency edge。

```bash
node scripts/ai-candidates-fixture.mjs artifacts/ai-demo
npm run analyze -- --root artifacts/ai-demo --system system.json --out ../analysis
# 啟動 UI 後查看未審核候選；以下為模擬人工接受 QA 候選的版本：
npm run analyze -- --root artifacts/ai-demo --system accepted.json --out ../analysis
```

Fixture 是模擬 Kotlin source 與人工編寫的候選，不是真實 AI 執行或真實人工審查。正式流程、template/check 指令與 review 欄位請看 [AI candidates guide](ai-candidates.md)。Reviewer 是本地設定的聲明，不是已驗證身分；不可讓 AI 自行核准。gRPC target、自訂 property precedence、host/port 組裝仍維持 unknown。

### Runtime 擷取方式

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

## AI 候選審核：不用手改 hash

不同專案使用自己的設定 key 時，可使用新增的
[configuration binding 設定](configuration-bindings.md)。`spring-properties/2`
支援有界的 `.properties`／YAML 與明確環境變數 mapping；`ai-evidence/2`
讓 template 描述完整 URL key 或分開的 host／port keys，不要求修改專案格式。
新增 `spring-properties/3` 可解析有界的 `${key}`／`${key:default}` 與巢狀預設值，
在設定覆蓋完成後才展開，並在畫面顯示引用與預設值的證據。
這不是完整 Spring Boot 設定引擎：動態 placeholder key、relaxed binding、
Config Data imports、ConfigMap／Secret 引用、gRPC 仍未完成。
遇到循環或來源不完整會維持 unknown，不會套用預設值來掩蓋缺口。
完整設定與可執行範例見該文件。

AI 候選檔 commit 並固定 revision 後，可用以下指令列出各環境的待審項目；
不需要執行 Helm 或連線 cluster：

```bash
node scripts/ai-candidates.mjs queue --root APPROVED_ROOT --system system.json --service SERVICE_ID
```

檢查清單中的原始碼引用、conditions 與 unknowns，再用 `review` 指令明確指定
candidate ID、完整 hash、environment、instance、reviewer 與 reason。
指令支援 `accepted`、`rejected`、`unreviewed`（撤回該項審核），只產生新 manifest，
不覆寫原檔、不修改 Git，也不會一次批准所有環境。
完整指令見 [AI review workflow](ai-candidates.md#review-queue-and-safe-manifest-output)。

產出的 manifest 要重新 analyze，再重新載入頁面才會生效。
`accepted` 不是保證會有 edge：未知條件、不完整設定或不支援的 endpoint 仍會阻擋。
過期的 review 會列在 `staleReviews`，不會被自動刪除，需另外明確處理。

畫面 **Connections & evidence** 現在可搜尋 client、service、設定 key 或 reviewer，
也可篩選待審、接受、拒絕與需要調查的候選。右側直接顯示原始碼引用與 commit；
畫面是唯讀，篩選不會修改關係圖或送出審核。

### gRPC 設定（需明確選用新版 adapter）

source 使用 `ai-evidence/3`，candidate bundle 使用
`archi/ai-candidates-v1alpha3`，protocol 填 `gRPC`。
endpoint 可填 `host-port`（指定專案自己的 hostKey／portKey），或
`grpc-dns`（指定 key，其值需為 `dns:///host:port`）。
目標 instance 的 endpoint 也需宣告 `gRPC` 及對應 Service port；
cluster、namespace、selector、來源引用與分環境 review 仍需符合。
設定完整且已審核才可能產生 edge，舊版 adapter 不會自動改變行為。

畫面上的 `grpc://host:port` 只是內部比對識別值，不是要貼進程式的 target。
TLS／mTLS、DNS 實際結果及連通性都保持 unknown；不會發 request、連 cluster
或 polling。目前不支援 xDS、自訂 resolver、IPv6 或外部 gRPC target。

可用 `node scripts/grpc-fixture.mjs artifacts/grpc-demo` 建立新模擬資料，
再分析其 `accepted.json`：QA 有兩個明確標示為模擬的 review，production 沒有。
完整設定與限制見 [gRPC endpoints](grpc-endpoints.md)。

### ConfigMap 環境設定

instance 的 `configuration.adapter` 選 `spring-properties/4`，即可解析
Helm render 中的 `configMapKeyRef` 與 `envFrom.configMapRef`（含 prefix）。
每個應用環境變數仍需 `environmentBindings` 對應到專案自己的 property key。
解析只使用相同 cluster／namespace 的精確名稱；不會查詢 Kubernetes。

多個 envFrom 依順序覆寫，explicit env 再覆寫它們，最後才套用 application JSON
與 placeholder。缺少 ConfigMap／key，即使標成 optional，也會保持 unknown，
因為「render 沒看到」不代表實際環境沒有。

畫面的 **Rendered configuration references** 會列出來源與狀態。
Secret reference 會標示 opaque，不讀取內容；標準 Secret 文件在新匯出中會遮蔽
資料及其他 metadata。這不是通用機密掃描器，ConfigMap／literal env 仍不可放機密。
既有匯出不會自動清除；Secret 值解析、掛載檔案與 ConfigData imports 尚未支援。

模擬案例：`node scripts/configmap-fixture.mjs artifacts/configmap-demo`。
分析該資料夾的 `accepted.json` 後，可查看 QA 的設定來源與 gRPC 關係。
詳細設定見 [ConfigMap environment](configmap-environment.md)。

### Spring Boot 3 相容性驗證

`npm run test:spring-boot` 會 build 並啟動固定版本 Spring Boot 3.5.6 的 Java fixture，
比較 Spring Environment、ConfigurationProperties 與 Archi 的設定結果。
需要 Java 17+、Maven；首次 build 會下載依賴，不連 cluster、不啟動 web server。
測試成功只代表這個版本與列出的案例一致，不代表所有 Boot 3 寫法都支援。
ConfigData import 目前仍是已知缺口，測試要求 Archi 保持 incomplete。
案例與界線見 [Spring Boot compatibility](spring-boot-compatibility.md)。

### 明確綁定的 ConfigData imports

現在可選 `spring-properties/5`，用 `importBindings` 對應「宣告 import 的檔案」、
「原始 location 字串」與「pinned repository 的目標檔案」。支援多檔順序、巢狀
relative imports，以及檔案存在的 optional imports；不會依字串自動讀本機或網路。

必須確認沒有自動 profile variants，才可宣告
`importProfilePolicy: "no-variants-reviewed"`；不確定時保持 `propertiesComplete: false`。
optional 目標缺少、循環、重複載入或缺少綁定都保持 incomplete。
舊版 /4 的 import 行為不變。畫面 **Configuration imports** 可查看來源鏈與狀態。

可用 `node scripts/config-imports-fixture.mjs artifacts/imports-demo` 建立模擬案例。
完整設定見 [ConfigData import bindings](config-imports.md)。自動 profile
載入仍未支援，不要將這個範圍當作完整 Spring ConfigData 相容性。

## 多個 repositories 放哪裡？

不用先摘出 properties。把需要分析的 source 與 deployment repos 正常 clone
到同一個核准 workspace，例如 `/work/inputs/orders`、`/work/inputs/gateway`、
`/work/inputs/deploy`；Archi 本身可以另外放在 `/work/archi`。
`/work/inputs/system.json` 的 `repositories[]` 分別填 `id`、相對路徑
（例如 `orders`）與完整 40 字元 commit SHA。各檔案再以
`{"repository":"orders","path":"src/main/resources/application.properties"}` 引用。
manifest 仍需提供 project/service、release、instance 與設定來源綁定，並非只列 repo。

在 Archi 根目錄執行：

```bash
npm run analyze -- --root /work/inputs --system system.json --out /work/archi/artifacts/analysis
npm run dev
```

`--root` 是輸入 workspace；`--system` 與相對 `--out` 都以它為基準。
用絕對 `--out` 可避免寫錯位置。Archi 只讀 manifest 核准的 pinned Git objects，
不會自行 clone、fetch、checkout 或讀 dirty working-tree 修改。指定 commit
必須已存在本地。不同環境若要不同 revisions，目前用不同 manifest。

## ConfigMap 掛載檔案

`spring-properties/6` 的 `mountedFiles` 填的是 **container 內的完整路徑**，
不是本機 clone 路徑。Helm 必須能追到 ConfigMap、volume、volumeMount，且有效的
`SPRING_CONFIG_ADDITIONAL_LOCATION` 必須依序指向相同 `file:` 路徑。
支援 properties/YAML、`items` 改名及精確檔案 `subPath`。
畫面 **Mounted configuration files** 可查看來源與路徑；`projected` 不代表 runtime 已讀取。

目前不支援 mounted file 內的 imports、自動 profile 變體、Secret/binaryData、
subPathExpr 或未知掛載來源。缺資料會標 incomplete，不會據此建立 dependency。
完整設定與範例見 [Mounted configuration](mounted-configuration.md)。
