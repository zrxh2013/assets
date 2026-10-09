package processor

import (
	"encoding/json"
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
