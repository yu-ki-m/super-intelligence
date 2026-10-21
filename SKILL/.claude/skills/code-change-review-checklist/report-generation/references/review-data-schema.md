# JSON仕様

## 最上位

```json
{
  "title": "コード変更比較表",
  "orchestration": {},
  "commits": []
}
```

`commits`の各要素が1つのコミットタブになる。複数コミットを1要素へまとめない。

## 複数エージェント実行記録

`orchestration`はHTMLへ表示しない内部記録である。調査担当と検証担当の分離、コミットの欠落、並列実行、検証後の改変を生成前に検出するため、すべてのレポートで必須にする。

```json
{
  "orchestration": {
    "version": 1,
    "mode": "commit-parallel-independent-verification",
    "workerCapacity": 1,
    "requestedCommitOrder": ["4e91c2a"],
    "commits": [
      {
        "commitHash": "4e91c2a",
        "sourceKind": "commit",
        "targetRef": "4e91c2a000000000000000000000000000000000",
        "comparisonBase": "31c6d5c000000000000000000000000000000000",
        "investigation": {
          "taskId": "/report/investigate-4e91c2a",
          "batch": 1,
          "artifactPath": "work/4e91c2a/investigation.json",
          "status": "completed",
          "reviewUnitSha256": "64文字のSHA-256"
        },
        "verificationAttempts": [
          {
            "taskId": "/report/verify-4e91c2a-1",
            "batch": 1,
            "artifactPath": "work/4e91c2a/verification-1.json",
            "status": "passed",
            "freshContext": true,
            "issueCount": 0,
            "verifiedReviewUnitSha256": "64文字のSHA-256"
          }
        ],
        "correctionRounds": 0,
        "unresolvedIssues": 0
      }
    ]
  }
}
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `version` | 必須 | `1`を指定する。 |
| `mode` | 必須 | `commit-parallel-independent-verification`を指定する。 |
| `workerCapacity` | 必須 | 調整担当を除いて同時に実行できるサブエージェント数。複数コミットでは2以上にし、最後以外の調査バッチはこの件数まで埋める。 |
| `requestedCommitOrder` | 必須 | 調査開始時に確定したコミットIDを表示順で記載する。`commits[].hash`と完全一致させる。 |
| `commits` | 必須 | 各コミットの調査と検証の記録。`requestedCommitOrder`と同じ順で1件ずつ記載する。 |

各`orchestration.commits[]`は次の条件を満たす。

- `commitHash`は同じ位置にある`commits[].hash`と一致する。
- `sourceKind`は固定コミットを調査する場合に`commit`、未コミット差分を調査する場合に`working-tree`を指定する。
- `sourceKind: commit`では、`targetRef`と`comparisonBase`へ40桁または64桁の完全なGitオブジェクトIDを記載する。`commitHash`は`targetRef`の先頭と一致させる。ルートコミットの`comparisonBase`にはGit空ツリーのオブジェクトIDを指定する。
- `sourceKind: working-tree`では、`commitHash`を`working-tree`、`targetRef`を`WORKING_TREE`とする。`comparisonBase`には基準にするHEADの完全なオブジェクトIDを記載する。調査開始時と生成直前に同じ方法で計算した`initialSnapshotSha256`と`finalSnapshotSha256`も必須とし、2つを一致させる。
- `investigation.taskId`には1コミットだけを担当した調査タスクの識別子を記載する。
- `investigation.batch`には調査を同時開始した単位の番号を1から連番で記載する。最後以外のバッチは`workerCapacity`件、最後のバッチは残件数とし、利用可能な枠へ収まる調査を不要に分割しない。
- `investigation.artifactPath`には調査担当が出力した内部JSONの固有な相対パスを記載する。ファイルはレポートJSONと同じディレクトリ以下に置く。
- `investigation.status`は`completed`だけを許可する。
- `investigation.reviewUnitSha256`には、対象Git参照、比較元、必要なスナップショット、最終的なコミットJSONを含む調査単位のSHA-256を記載する。
- `verificationAttempts`には検証を実行順で記載する。最後の要素は`passed`かつ`issueCount: 0`にする。それ以前の要素は`failed`かつ1以上の`issueCount`にする。再検証は修正完了後に開始するため、同じコミット内の後続試行には直前より大きい`batch`を設定する。
- 各検証の`freshContext`は`true`にする。調査担当と同じタスク、過去の検証と同じタスクを再利用しない。
- `verifiedReviewUnitSha256`には、その検証担当が実際に確認した調査単位のSHA-256を記載する。最後の値は統合後の調査単位と一致させる。失敗した検証の直後には修正済みデータを渡し、前回と同じSHA-256を記録しない。
- `correctionRounds`は`verificationAttempts.length - 1`と一致させる。
- `unresolvedIssues`は`0`にする。

調査タスクとすべての検証タスクの`taskId`は、レポート全体で重複させない。すべての`artifactPath`と、そのパスが示す実ファイルも重複させない。同じタスクが複数コミットを調査または検証したように記録した場合、生成処理は拒否する。`artifactPath`はレポートJSONがあるディレクトリを基準に解決する相対パスとし、そのディレクトリ外を指す`..`、絶対パス、シンボリックリンク、通常ファイルではない対象を使用しない。

### 調査証跡JSON

`investigation.artifactPath`のファイルには、次の項目を記載する。追加の調査記録を同じJSONへ含めてもよい。

```json
{
  "schemaVersion": 1,
  "role": "investigator",
  "taskId": "/report/investigate-4e91c2a",
  "commitHash": "4e91c2a",
  "sourceKind": "commit",
  "targetRef": "4e91c2a000000000000000000000000000000000",
  "comparisonBase": "31c6d5c000000000000000000000000000000000",
  "status": "completed",
  "reviewUnitSha256": "64文字のSHA-256"
}
```

未コミット差分の証跡には、`initialSnapshotSha256`と`finalSnapshotSha256`に共通する値を`"snapshotSha256": "64文字のSHA-256"`として追加する。

### 検証証跡JSON

各`verificationAttempts[].artifactPath`のファイルには、次の項目を記載する。`issues`の要素数は`issueCount`と一致させる。失敗時の各要素には、対象ステップ、Git上の根拠、必要な修正を記載する。

```json
{
  "schemaVersion": 1,
  "role": "verifier",
  "taskId": "/report/verify-4e91c2a-1",
  "commitHash": "4e91c2a",
  "sourceKind": "commit",
  "targetRef": "4e91c2a000000000000000000000000000000000",
  "comparisonBase": "31c6d5c000000000000000000000000000000000",
  "status": "passed",
  "freshContext": true,
  "issueCount": 0,
  "issues": [],
  "verifiedReviewUnitSha256": "64文字のSHA-256"
}
```

未コミット差分の証跡には、調査証跡と同じ`"snapshotSha256": "64文字のSHA-256"`を追加する。検証が失敗した場合、`issues`の各要素は次の形式にする。

```json
{
  "stepId": "問題があるステップID",
  "evidence": "問題を確認できるGit参照、ファイル位置、コード上の根拠",
  "requiredCorrection": "調査担当がJSONの何をどう直す必要があるか"
}
```

調査単位のSHA-256は、`sourceKind`、`targetRef`、`comparisonBase`、`commit`を含むオブジェクトから計算する。未コミット差分の場合だけ、一致確認済みのスナップショットを`snapshotSha256`として同じオブジェクトへ加える。対象オブジェクトのキーを再帰的に昇順へ並べたJSON文字列をSHA-256へ入力する。手作業で計算せず、`orchestration`の比較計画と`commits`を組み立てたJSONに対して次のコマンドを実行する。

```bash
node <skill-root>/scripts/verify-orchestration.mjs --print-digests <review-data.json>
```

`scripts/verify-orchestration.mjs`は、実行記録、`commits`、調査証跡、検証証跡を照合する。実行記録と証跡JSONは、エージェント実行基盤が発行する署名ではないため、別エージェントを実際に起動したことを暗号学的には証明しない。エージェントの割り当てとコンテキスト分離は[複数エージェント実行規則](multi-agent-orchestration.md)に従い、生成検査は記録の欠落と相互矛盾を拒否する。

## コミット

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `hash` | 必須 | 表示するコミットID。短縮IDでもよい。 |
| `message` | 必須 | コミットメッセージ。 |
| `overview` | 必須 | コミット全体が何を変え、利用者、業務データ、後続処理へどの結果を生むかを説明する。変更箇所の列挙だけを書かない。 |
| `author` | 任意 | コミット作成者。 |
| `committedAt` | 任意 | コミット日時。 |
| `callerCoverage` | 必須 | 変更対象ごとの探索根拠、検出した呼び出し箇所、掲載フローとの対応を記録する。 |
| `steps` | 必須 | 1段目の処理を実行順に並べた配列。 |

コミットの`overview`は、最初の1〜2文で「つまり何が変わるのか」を説明する。続けて、理解に必要な前提と、複数の変更が結果を生む因果関係を記載する。抽象的な説明を使った場合は、その直後に外部から確認できる具体例を記載する。具体例の導入語句は固定せず、`例えば`という文字列を必須にしない。ファイル名、クラス名、メソッド名の列挙だけで説明を終えない。

## ステップ

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `id` | 必須 | コミット内で重複しないステップID。呼び出し元網羅性検査が参照する。 |
| `flowTitle` | 第1階層の開始ステップで必須 | コミット先頭または`connectFromPrevious: false`のステップに表示するタイトル。後続の第1階層ステップと入れ子には指定しない。 |
| `flowDescription` | 処理フローの開始ステップで必須 | 複数の第1階層ステップまたは入れ子を含む場合に、処理の開始、経路、結果を1〜2文で説明する。単独テーブルには指定しない。 |
| `filePath` | 必須 | 表示基準にするGit参照における、リポジトリルートからの相対パス。 |
| `startLine` | 必須 | 表示基準側のコード断片が始まる1始まりの行番号。 |
| `endLine` | 必須 | 表示基準側のコード断片が終わる1始まりの行番号。この行を範囲へ含める。 |
| `language` | 必須 | Shikiが解釈する言語名。例: `java`, `typescript`, `xml`。 |
| `beforeCode` | 必須 | 親コミット側のコード。純粋な追加では空文字を使用できる。 |
| `afterCode` | 必須 | 対象コミット側のコード。純粋な削除では空文字を使用できる。 |
| `overview` | 必須 | 変更内容、または未変更コードの役割を1〜2文で記載する。未変更ステップでは変更有無を記載しない。 |
| `reason` | 必須 | 変更ステップでは変更理由を記載する。未変更ステップでは`変更なし`だけを記載する。 |
| `specification` | 必須 | `summary`、`steps`、任意の`example`で構成するオブジェクト。対象コミット適用後の意味、番号付きの処理手順、必要な場合の具体例を分けて記載する。 |
| `remarks` | 必須 | 用語、前提、影響範囲、対象外、運用上の注意を記載する。コード上の根拠がある懸念点、バグ、考慮漏れがあれば、分類、根拠、発生条件、影響、必要な確認または対応を記載する。 |
| `calls` | 必須 | このステップが呼び出す処理フローの配列。呼び出しがなければ`[]`。 |
| `connectFromPrevious` | 1段目のみ任意 | `false`の場合、直前の1段目と線で接続しない。省略時は接続する。 |

未変更ステップでは`beforeCode`と`afterCode`へ同じコードを設定し、`reason`へ`変更なし`を設定する。生成処理は同一行を着色せず、変更行だけを赤または緑で表示する。

## ファイル位置の基準

`afterCode`が空でない場合、`filePath`、`startLine`、`endLine`は対象コミット側の`afterCode`を指す。純粋な削除で`afterCode`が空の場合、3項目は親コミット側の`beforeCode`を指す。ファイルが移動または名称変更されている場合は、表示基準にした側のパスを`filePath`へ設定する。

`endLine - startLine + 1`は、表示基準側のコード断片の行数と一致しなければならない。改行コードの違いと末尾の改行1つだけを比較時に正規化し、インデント、空白行、行内の空白はコードの一部として数える。JSON検証は行数が一致しないステップを拒否する。

HTML生成前に、対象コミットまたは親コミットの実ファイルから範囲を抽出し、コード断片と完全一致することを全テーブルで確認する。`beforeCode`が空でなければ親コミット側、`afterCode`が空でなければ対象コミット側にも断片が実在することを確認する。不一致を直した場合は全テーブルを再照合し、未解決を0件にする。

`specification`は次の形式にする。`example`は、`summary`または`steps`で抽象的な説明を使う場合だけ追加する。

```json
{
  "summary": "この処理が何を成立させるかを1〜2文で記載する。",
  "steps": [
    "主体が受け取る入力と、その入力を使って行う1つの動作を記載する。",
    "次の主体が受け取る値と、その直後に生じる結果を記載する。"
  ],
  "example": "具体的な入力を与えると、外部から確認できる結果が生じる。"
}
```

`summary`の最初の文ではメソッド呼び出しを記載せず、その処理が持つ意味を説明する。`steps`には2件以上を設定し、実コードの順序で1項目につき1つの動作または判定を説明する。番号はHTMLの`ol`要素が表示するため、各文字列へ`1.`などを含めない。`example`を記載する場合は具体的な入力と観測できる結果を示すが、導入語句は固定しない。説明自体が具体的であれば`example`を省略できる。検証処理は、この構造を満たさないJSONを拒否する。

`remarks`へレビュー上の指摘を書く場合は、先頭に`[バグ]`、`[懸念点]`、`[考慮漏れ]`のいずれかを付ける。`[バグ]`はコードから誤動作を確認できる場合に限る。追加確認が必要な内容は`[懸念点]`とする。指摘がない場合は、備考欄を埋める目的で問題を作らない。

## 第1階層のタイトル

コミット先頭のステップと`connectFromPrevious: false`を指定したステップが、第1階層の新しい表示単位を開始する。各開始ステップには`flowTitle`を設定する。

開始ステップから次の`connectFromPrevious: false`までに第1階層ステップが複数ある場合、またはその範囲のステップが表示対象の`calls`を持つ場合、生成処理はその表示単位を処理フローとして扱う。処理フローでは`flowDescription`も必須になる。`flowDescription`には、開始契機、経由する主要処理、利用者または後続処理が受け取る結果を記載する。

表示単位が入れ子も接続先も持たない1テーブルだけの場合、生成処理は単独テーブルとして扱う。単独テーブルには`flowTitle`だけを設定し、`flowDescription`を指定しない。

```json
{
  "steps": [
    {
      "id": "order-entry",
      "flowTitle": "注文登録から保存結果を返すフロー",
      "flowDescription": "OrderControllerが注文登録を受け付けてから、OrderServiceとOrderRepositoryが注文を保存し、登録結果を返すまでを示す。",
      "calls": [{ "steps": [{ "id": "order-service", "calls": [] }] }]
    },
    {
      "id": "logging-config",
      "flowTitle": "監査ログの出力レベル設定",
      "connectFromPrevious": false,
      "calls": []
    }
  ]
}
```

## 呼び出し元網羅性

`callerCoverage.version`には`1`を指定する。`targets`には、コミット内の変更メソッド、変更された入口、コードから直接呼び出されない設定値などを登録する。すべての変更ステップIDは、少なくとも1件の`targets[].changedStepIds`に含める。

```json
{
  "callerCoverage": {
    "version": 1,
    "targets": [
      {
        "id": "order-service-create",
        "displayName": "OrderService.create(OrderRequest)",
        "analysisMode": "callers",
        "changedStepIds": ["service-create-from-controller", "service-create-from-job"],
        "evidence": [
          {
            "kind": "semantic",
            "method": "LSP Call Hierarchy",
            "scope": "src",
            "query": "OrderService.create(OrderRequest)",
            "resultSummary": "ControllerとJobの2件を検出した。",
            "callSiteIds": ["controller-call", "job-call"]
          },
          {
            "kind": "text",
            "method": "rg",
            "scope": "src",
            "query": "orderService.create(",
            "resultSummary": "ControllerとJobの2件を検出した。",
            "callSiteIds": ["controller-call", "job-call"]
          }
        ],
        "callSites": [
          {
            "id": "controller-call",
            "callerSymbol": "OrderController.create(OrderRequest)",
            "callerPath": "src/main/java/example/OrderController.java",
            "startLine": 21,
            "endLine": 21,
            "status": "included",
            "entryStepId": "controller-entry",
            "callerStepId": "controller-entry",
            "changedStepId": "service-create-from-controller"
          },
          {
            "id": "job-call",
            "callerSymbol": "OrderJob.execute()",
            "callerPath": "src/main/java/example/OrderJob.java",
            "startLine": 30,
            "endLine": 30,
            "status": "included",
            "entryStepId": "job-entry",
            "callerStepId": "job-entry",
            "changedStepId": "service-create-from-job"
          }
        ]
      }
    ]
  }
}
```

`analysisMode`は次のいずれかにする。

| 値 | 用途 |
| --- | --- |
| `callers` | 別のコードが変更対象を呼び出す。`evidence`へ`semantic`を1件以上、`text`または`framework`を1件以上記録し、検出した呼び出し箇所を`callSites`へ登録する。 |
| `entry-point` | 変更対象自体がController、Listener、Jobなどの入口である。`entryStepId`へ独立フローの先頭ステップを指定する。 |
| `not-applicable` | 設定値やSQL定義など、コードから呼び出される対象ではない。`reason`へ適用外となる理由を記載する。 |

`evidence.kind`は`semantic`、`text`、`framework`、`manual`のいずれかにする。`scope`には、探索したディレクトリ、モジュール、設定ファイルなどの範囲を記載する。各`evidence.callSiteIds`には、その探索で検出した呼び出し箇所IDを記載する。探索結果にあるIDが`callSites`にない場合、または`callSites`のIDを検出した探索根拠がない場合、検証処理はHTML生成を停止する。

`callSites[].status`は次のいずれかにする。

| 値 | 必須項目と動作 |
| --- | --- |
| `included` | `entryStepId`、`callerStepId`、`changedStepId`を指定する。呼び出し元のファイルと行範囲がステップに一致し、変更ステップが呼び出し元の入れ子にあることを検査する。 |
| `excluded` | `callerPath`、行範囲、`reason`を指定する。理由が空の場合は生成を停止する。 |
| `unresolved` | 確定できない対象と`reason`を記載する。1件でも存在する場合は生成を停止する。 |

`callers`では、各`included`へ異なる`changedStepId`を指定する。複数の呼び出し元が同じ変更ステップを共有した場合、検証処理はHTML生成を停止する。

同じ変更対象の`callSites`では、`callerPath`、`startLine`、`endLine`が同じ呼び出し箇所を複数のIDで登録してはならない。検証処理はこの重複も検出し、HTML生成を停止する。

## 入れ子と戻り

```json
{
  "steps": [
    {
      "id": "controller-create-call",
      "filePath": "OrderController.java",
      "startLine": 18,
      "endLine": 21,
      "language": "java",
      "beforeCode": "OrderResponse response = orderService.create(request);",
      "afterCode": "OrderResponse response = orderService.create(request);",
      "overview": "OrderControllerはHTTPリクエストを受け取り、注文データをOrderServiceへ渡す入口である。",
      "reason": "変更なし",
      "specification": {
        "summary": "この処理は、API利用者が送った注文を業務処理へ渡し、登録結果が確定してから応答する入口である。",
        "steps": [
          "OrderControllerがHTTPリクエストからOrderRequestを受け取る。",
          "OrderControllerがOrderRequestをOrderServiceへ渡し、結果または例外が戻るまで待つ。",
          "OrderControllerが戻り値を後続のHTTPレスポンス作成へ渡す。"
        ],
        "example": "保存処理が失敗した場合、OrderControllerは成功レスポンスを返さず、既存の例外処理へ制御を渡す。"
      },
      "remarks": "Controllerとは、この処理ではHTTPリクエストを受け取るクラスを指す。",
      "calls": [
        {
          "steps": []
        }
      ]
    },
    {
      "id": "controller-return",
      "filePath": "OrderController.java",
      "startLine": 23,
      "endLine": 24,
      "language": "java",
      "beforeCode": "return ResponseEntity.ok(response);",
      "afterCode": "return ResponseEntity.ok(response);",
      "overview": "OrderControllerはOrderServiceの登録結果をHTTPレスポンスとしてAPI利用者へ返す。",
      "reason": "変更なし",
      "specification": {
        "summary": "この処理は、登録が完了した注文だけを成功結果としてAPI利用者へ返す。",
        "steps": [
          "OrderControllerがOrderServiceから登録結果を受け取る。",
          "OrderControllerが登録結果をHTTPレスポンスの本文へ設定する。",
          "OrderControllerが成功ステータスと本文をAPI利用者へ返す。"
        ],
        "example": "注文ID1001の登録が完了すると、利用者は成功ステータスと注文ID1001を含む本文を受け取る。"
      },
      "remarks": "HTTPレスポンスとは、サーバーがAPI利用者へ返すステータスと本文を指す。",
      "calls": []
    }
  ]
}
```

呼び出し元メソッドの`return`は、呼び出し先を記載する上段へ入れない。呼び出し先の`steps`を閉じた後、親階層の次ステップとして記載する。

`calls`を持つステップの直後に接続されたステップを置く場合、次ステップの`filePath`は呼び出し元ステップと同じ値にする。次ステップの`startLine`は呼び出し元ステップの`endLine`より後にする。生成前の構造検査はこの2条件を満たさないJSONを拒否する。呼び出し後の文がない場合は次ステップを作らず、生成後の検証で実コード上の根拠を確認する。

最大深度は10,000段である。通常の報告では実コード上の呼び出し関係だけを記載し、表示段数を増やす目的で架空の階層を作らない。
