/**
 * tronweb 没有官方 TypeScript 类型声明（@types/tronweb 不存在），
 * 这里提供最小声明，使脚本通过类型检查。
 */
declare module "tronweb" {
  const TronWeb: any;
  export default TronWeb;
}
