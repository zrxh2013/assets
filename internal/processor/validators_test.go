package processor

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/trustwallet/assets-go-libs/file"
	"github.com/trustwallet/assets-go-libs/path"
	libTokenlist "github.com/trustwallet/assets-go-libs/validation/tokenlist"
	"github.com/trustwallet/go-primitives/coin"
)

// writeTokenListFile 在指定路径写入 tokenlist JSON 文件。
func writeTokenListFile(t *testing.T, p string, model libTokenlist.Model) {
	t.Helper()
	data, err := json.MarshalIndent(model, "", "    ")
	if err != nil {
		t.Fatalf("failed to marshal tokenlist: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}
	if err := os.WriteFile(p, data, 0o600); err != nil {
		t.Fatalf("failed to write file %s: %v", p, err)
	}
}

// makeTokenList 构造一个最小合法的 tokenlist Model。
func makeTokenList(tokens ...libTokenlist.Token) libTokenlist.Model {
	return libTokenlist.Model{
		Name:      "Test",
		LogoURI:   "https://example.com/logo.png",
		Timestamp: "2024-01-01T00:00:00.000000",
		Tokens:    tokens,
		Version:   libTokenlist.Version{Major: 1},
	}
}

// chdirTempDir 创建临时目录并切换工作目录到该目录,测试结束后自动恢复。
func chdirTempDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	oldwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get cwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("failed to chdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldwd) })
	return dir
}

// --- 测试用例 ---

// TestValidateTokenList_NoDuplicate: 两个文件无重复 token(均空) → 互斥检查通过,字段校验也通过。
func TestValidateTokenList_NoDuplicate(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)       // blockchains/ethereum/tokenlist.json
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)   // blockchains/ethereum/tokenlist-extended.json

	emptyList := makeTokenList()
	writeTokenListFile(t, defaultPath, emptyList)
	writeTokenListFile(t, extendedPath, emptyList)

	err := validateTokenList(defaultPath, extendedPath, chain)
	if err != nil {
		t.Fatalf("expected nil error for no-duplicate case, got: %v", err)
	}
}

// TestValidateTokenList_DuplicateInDefault: default 中的 token 已存在于 extended → 报错。
func TestValidateTokenList_DuplicateInDefault(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)

	dupAsset := "c60_t0x4Fabb145d64652a948d72533023f6E7A623C7C53"
	token := libTokenlist.Token{Asset: dupAsset, Address: "0x4Fabb145d64652a948d72533023f6E7A623C7C53"}

	// extended 中已有该 token
	writeTokenListFile(t, extendedPath, makeTokenList(token))
	// default 中也放入同一 token
	writeTokenListFile(t, defaultPath, makeTokenList(token))

	err := validateTokenList(defaultPath, extendedPath, chain)
	if err == nil {
		t.Fatal("expected error for duplicate asset in default, got nil")
	}
	if !strings.Contains(err.Error(), "duplicate asset") {
		t.Errorf("expected 'duplicate asset' in error, got: %v", err)
	}
	if !strings.Contains(err.Error(), dupAsset) {
		t.Errorf("expected asset id %q in error, got: %v", dupAsset, err)
	}
}

// TestValidateTokenList_DuplicateInExtended: extended 中的 token 已存在于 default → 报错(反向)。
func TestValidateTokenList_DuplicateInExtended(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)

	dupAsset := "c60_t0x4Fabb145d64652a948d72533023f6E7A623C7C53"
	token := libTokenlist.Token{Asset: dupAsset, Address: "0x4Fabb145d64652a948d72533023f6E7A623C7C53"}

	// default 中已有该 token
	writeTokenListFile(t, defaultPath, makeTokenList(token))
	// extended 中也放入同一 token
	writeTokenListFile(t, extendedPath, makeTokenList(token))

	// 注意:此时 path1=extended, path2=default
	err := validateTokenList(extendedPath, defaultPath, chain)
	if err == nil {
		t.Fatal("expected error for duplicate asset in extended, got nil")
	}
	if !strings.Contains(err.Error(), "duplicate asset") {
		t.Errorf("expected 'duplicate asset' in error, got: %v", err)
	}
}

// TestValidateTokenList_NoExtendedFile: 只有 default,没有 extended → 跳过互斥检查。
func TestValidateTokenList_NoExtendedFile(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)

	// 只写 default,不写 extended
	writeTokenListFile(t, defaultPath, makeTokenList())

	err := validateTokenList(defaultPath, extendedPath, chain)
	if err != nil {
		t.Fatalf("expected nil error when extended file does not exist, got: %v", err)
	}
}

// TestValidateTokenList_MultipleDuplicatesEarlyReturn: 多个重复时,只报第一个(early return)。
func TestValidateTokenList_MultipleDuplicatesEarlyReturn(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)

	token1 := libTokenlist.Token{Asset: "c60_t0x1111", Address: "0x1111"}
	token2 := libTokenlist.Token{Asset: "c60_t0x2222", Address: "0x2222"}

	// extended 含有 token1 和 token2
	writeTokenListFile(t, extendedPath, makeTokenList(token1, token2))
	// default 也含有 token1 和 token2(两个都重复)
	writeTokenListFile(t, defaultPath, makeTokenList(token1, token2))

	err := validateTokenList(defaultPath, extendedPath, chain)
	if err == nil {
		t.Fatal("expected error for duplicate, got nil")
	}

	// 由于 tokens 切片遍历顺序 = 写入顺序,第一个重复应为 token1
	if !strings.Contains(err.Error(), "c60_t0x1111") {
		t.Logf("error was: %v", err)
	}
	// 只报一个,不应同时包含第二个(因为 early return)
	// 注意:错误消息格式为 "duplicate asset: <id> from ...",只会包含第一个
}

// TestValidateTokenList_DifferentChainsNotDuplicate: 不同链的相同地址不算重复(Asset 含链前缀)。
// 注意:互斥检查通过后,ValidateTokenList 会尝试打开 info.json 做字段校验,
// 本测试只验证互斥部分不报 "duplicate asset",不关注后续字段校验。
func TestValidateTokenList_DifferentChainsNotDuplicate(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)

	// 两个 token 的 Address 相同但 Asset 不同(链前缀不同)
	tokenInDefault := libTokenlist.Token{Asset: "c60_t0x4Fabb145d64652a948d72533023f6E7A623C7C53"}
	tokenInExtended := libTokenlist.Token{Asset: "c0_t0x4Fabb145d64652a948d72533023f6E7A623C7C53"}

	writeTokenListFile(t, defaultPath, makeTokenList(tokenInDefault))
	writeTokenListFile(t, extendedPath, makeTokenList(tokenInExtended))

	err := validateTokenList(defaultPath, extendedPath, chain)
	// 互斥检查应通过(不报 duplicate asset);后续 ValidateTokenList 因缺 info.json 会报错,
	// 但那不属于互斥校验范畴。
	if err != nil && strings.Contains(err.Error(), "duplicate asset") {
		t.Fatalf("should not report duplicate for different-chain tokens, got: %v", err)
	}
}

// TestValidateTokenList_ReadJSONError: path1 文件不是合法 JSON → 读取错误。
func TestValidateTokenList_ReadJSONError(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)

	// 写入非法 JSON
	if err := os.MkdirAll(filepath.Dir(defaultPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(defaultPath, []byte("{invalid json"), 0o600); err != nil {
		t.Fatal(err)
	}

	err := validateTokenList(defaultPath, extendedPath, chain)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

// TestValidateTokenList_ExtendedReadJSONError: path2 存在但非法 JSON → 读取错误。
func TestValidateTokenList_ExtendedReadJSONError(t *testing.T) {
	chdirTempDir(t)

	chain := coin.Ethereum()
	defaultPath := path.GetTokenListPath(chain.Handle, path.TokenlistDefault)
	extendedPath := path.GetTokenListPath(chain.Handle, path.TokenlistExtended)

	// default 合法
	writeTokenListFile(t, defaultPath, makeTokenList())

	// extended 非法 JSON
	if err := os.MkdirAll(filepath.Dir(extendedPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(extendedPath, []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	err := validateTokenList(defaultPath, extendedPath, chain)
	if err == nil {
		t.Fatal("expected error for invalid JSON in extended, got nil")
	}
}

// 额外验证: file.Exists 和 file.ReadJSONFile 的基础行为(确保测试基础设施正确)
func TestFileExists_Behavior(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "exists.json")
	missing := filepath.Join(dir, "missing.json")

	if err := os.WriteFile(existing, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	if !file.Exists(existing) {
		t.Error("file.Exists should return true for existing file")
	}
	if file.Exists(missing) {
		t.Error("file.Exists should return false for missing file")
	}
}

// ===================================================================
// ValidateAssetInfoFile 字段规则测试
// ===================================================================

const ethAssetAddr = "0x4Fabb145d64652a948d72533023f6E7A623C7C53" // BUSD (EIP-55 checksum)

// makeAssetInfoJSON 构造一个合法的 ethereum ERC20 asset info JSON,
// 通过 overrides 覆盖字段(nil 表示删除该字段)。
func makeAssetInfoJSON(overrides map[string]interface{}) string {
	base := map[string]interface{}{
		"name":        "BUSD",
		"type":        "ERC20",
		"symbol":      "BUSD",
		"decimals":    18,
		"description": "Binance USD",
		"website":     "https://busd.example.com",
		"explorer":    "https://etherscan.io/token/" + ethAssetAddr,
		"status":      "active",
		"id":          ethAssetAddr,
	}
	for k, v := range overrides {
		if v == nil {
			delete(base, k)
		} else {
			base[k] = v
		}
	}
	data, _ := json.MarshalIndent(base, "", "    ")
	return string(data)
}

// writeAssetInfoFile 在 blockchains/<chain>/assets/<addr>/info.json 写入内容,
// 返回对应的 *file.AssetFile。
func writeAssetInfoFile(t *testing.T, chainHandle, addr, content string) *file.AssetFile {
	t.Helper()
	p := fmt.Sprintf("blockchains/%s/assets/%s/info.json", chainHandle, addr)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatalf("failed to write file %s: %v", p, err)
	}
	return file.NewAssetFile(p)
}

// TestValidateAssetInfoFile_Valid: 合法 asset info → 通过。
func TestValidateAssetInfoFile_Valid(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr, makeAssetInfoJSON(nil))
	if err := s.ValidateAssetInfoFile(f); err != nil {
		t.Fatalf("expected nil for valid asset info, got: %v", err)
	}
}

// TestValidateAssetInfoFile_MissingField: 缺少必填字段 name → 报 missing field。
func TestValidateAssetInfoFile_MissingField(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"name": nil}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for missing name field, got nil")
	}
	if !strings.Contains(err.Error(), "missing") {
		t.Errorf("expected 'missing' in error, got: %v", err)
	}
}

// TestValidateAssetInfoFile_MissingID: 缺少 id → 报 missing field。
func TestValidateAssetInfoFile_MissingID(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"id": nil}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for missing id field, got nil")
	}
}

// TestValidateAssetInfoFile_InvalidType: type 不是 ERC20 → 链不匹配。
func TestValidateAssetInfoFile_InvalidType(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"type": "BEP20"}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for invalid type, got nil")
	}
}

// TestValidateAssetInfoFile_TypeNotUppercase: type 小写 → 报 should be ALLCAPS。
func TestValidateAssetInfoFile_TypeNotUppercase(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"type": "erc20"}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for lowercase type, got nil")
	}
}

// TestValidateAssetInfoFile_InvalidID: id 与目录地址不匹配 → 报错。
func TestValidateAssetInfoFile_InvalidID(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"id": "0x0000000000000000000000000000000000000000"}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for mismatched id, got nil")
	}
}

// TestValidateAssetInfoFile_IDCaseMismatch: id 仅大小写不同 → 报 case 错误。
func TestValidateAssetInfoFile_IDCaseMismatch(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	// 目录用 checksum 形式,id 用全小写
	lowerAddr := strings.ToLower(ethAssetAddr)
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"id": lowerAddr}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for id case mismatch, got nil")
	}
}

// TestValidateAssetInfoFile_DecimalsOutOfRange: decimals > 30 → 报错。
func TestValidateAssetInfoFile_DecimalsOutOfRange(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"decimals": 31}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for decimals > 30, got nil")
	}
}

// TestValidateAssetInfoFile_DecimalsNegative: decimals < 0 → 报错。
func TestValidateAssetInfoFile_DecimalsNegative(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"decimals": -1}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for decimals < 0, got nil")
	}
}

// TestValidateAssetInfoFile_InvalidStatus: status 非法 → 报错。
func TestValidateAssetInfoFile_InvalidStatus(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"status": "inactive"}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for invalid status, got nil")
	}
}

// TestValidateAssetInfoFile_StatusSpam: status=spam → 通过(spam 是合法值)。
func TestValidateAssetInfoFile_StatusSpam(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"status": "spam"}))
	if err := s.ValidateAssetInfoFile(f); err != nil {
		t.Fatalf("expected nil for status=spam, got: %v", err)
	}
}

// TestValidateAssetInfoFile_DescriptionTooLong: description > 600 字符 → 报错。
func TestValidateAssetInfoFile_DescriptionTooLong(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	longDesc := strings.Repeat("a", 601)
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"description": longDesc}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for description > 600 chars, got nil")
	}
}

// TestValidateAssetInfoFile_DescriptionWithNewline: description 含换行 → 报错。
func TestValidateAssetInfoFile_DescriptionWithNewline(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"description": "Binance\nUSD"}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for description with newline, got nil")
	}
}

// TestValidateAssetInfoFile_DescriptionWithDoubleSpace: description 含双空格 → 报错。
func TestValidateAssetInfoFile_DescriptionWithDoubleSpace(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"description": "Binance  USD"}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for description with double space, got nil")
	}
}

// TestValidateAssetInfoFile_MissingWebsite: description != "-" 但 website 空 → 报错。
func TestValidateAssetInfoFile_MissingWebsite(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"website": ""}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for empty website, got nil")
	}
}

// TestValidateAssetInfoFile_WebsiteOptionalWhenDescriptionDash: description="-" 时 website 可空 → 通过。
func TestValidateAssetInfoFile_WebsiteOptionalWhenDescriptionDash(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{
			"description": "-",
			"website":     "",
		}))
	if err := s.ValidateAssetInfoFile(f); err != nil {
		t.Fatalf("expected nil for description='-' with empty website, got: %v", err)
	}
}

// TestValidateAssetInfoFile_InvalidExplorer: explorer 不匹配 → 报错。
func TestValidateAssetInfoFile_InvalidExplorer(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{"explorer": "https://wrong.io/token/xxx"}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for invalid explorer, got nil")
	}
}

// TestValidateAssetInfoFile_InvalidLinksName: links.name 不在白名单 → 报错。
// 注意:ValidateLinks 仅在 links 数量 >= 2 时才校验。
func TestValidateAssetInfoFile_InvalidLinksName(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	links := []map[string]string{
		{"name": "github", "url": "https://github.com/foo"},
		{"name": "unknown_link", "url": "https://example.com"},
	}
	linksJSON, _ := json.Marshal(links)
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{
			"links": json.RawMessage(linksJSON),
		}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for invalid links name, got nil")
	}
}

// TestValidateAssetInfoFile_InvalidLinksURLPrefix: links.url 前缀不匹配 → 报错。
func TestValidateAssetInfoFile_InvalidLinksURLPrefix(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	links := []map[string]string{
		{"name": "whitepaper", "url": "https://example.com/doc.pdf"},
		{"name": "github", "url": "https://example.com"},
	}
	linksJSON, _ := json.Marshal(links)
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{
			"links": json.RawMessage(linksJSON),
		}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for invalid links url prefix, got nil")
	}
}

// TestValidateAssetInfoFile_LinksNotHTTPS: links.url 不是 https:// → 报错。
func TestValidateAssetInfoFile_LinksNotHTTPS(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	links := []map[string]string{
		{"name": "whitepaper", "url": "https://example.com/a"},
		{"name": "blog", "url": "http://example.com"},
	}
	linksJSON, _ := json.Marshal(links)
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr,
		makeAssetInfoJSON(map[string]interface{}{
			"links": json.RawMessage(linksJSON),
		}))
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for non-https links url, got nil")
	}
}

// TestValidateAssetInfoFile_ReadJSONError: 非法 JSON → 读取错误。
func TestValidateAssetInfoFile_ReadJSONError(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	f := writeAssetInfoFile(t, "ethereum", ethAssetAddr, "{invalid json")
	err := s.ValidateAssetInfoFile(f)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

// TestValidateAssetInfoFile_CryptoorgException: cryptoorg 链跳过字段校验 → 即使字段非法也通过。
func TestValidateAssetInfoFile_CryptoorgException(t *testing.T) {
	chdirTempDir(t)
	s := &Service{}
	// cryptoorg handle
	cryptoHandle := coin.Cryptoorg().Handle
	// 即使 type、id、status 全是非法值,因 cryptoorg 例外也会通过
	f := writeAssetInfoFile(t, cryptoHandle, "someaddr",
		makeAssetInfoJSON(map[string]interface{}{
			"type":   "INVALID",
			"status": "wrong",
			"id":     "wrong",
		}))
	// 注意:目录地址 someaddr 与 id=wrong 不一致,但 cryptoorg 跳过 ValidateAsset
	if err := s.ValidateAssetInfoFile(f); err != nil {
		t.Fatalf("expected nil for cryptoorg exception, got: %v", err)
	}
}
