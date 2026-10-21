// 定義リンク(Java): JDK のコンパイラー API に、識別子ごとの定義の場所(リポジトリ内のファイルと行)を問い合わせる。
// 名前の一致では推測しない。依存ライブラリ(Maven / Gradle の依存)は読み込まないので、型が決まらないものはリンクしない。
// 依存が無いことで解決先が変わりうるもの(読み込めない親クラスに隠れたオーバーロードなど)も、リンクしない。
//
// 使い方(JDK 17 以降。ビルドは不要): java JavaXref.java <リポジトリのルート> <対象一覧> <結果の出力先>
//   対象一覧: 1行に「グループ<TAB>ルートからの相対パス」(UTF-8)。グループは pom.xml / build.gradle のあるフォルダー。
//   結果: xref.mjs と同じ形の JSON({ status, engine, files: { 相対パス: { hash, refs } }, targets, stats, notes })

import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.*;
import javax.lang.model.type.*;
import javax.lang.model.util.*;
import javax.tools.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

public class JavaXref {
  static Path root;
  static final Set<String> listed = new HashSet<>();
  static final Map<String, Integer> targetIndex = new HashMap<>();
  static final List<Object[]> targets = new ArrayList<>(); // { 相対パス, 行 }
  static final Map<String, Object[]> files = new LinkedHashMap<>(); // 相対パス → { hash, List<int[]> }
  static final List<String> notes = new ArrayList<>();
  static int errorCount = 0;
  static int refCount = 0;
  static Path emptyDir;

  public static void main(String[] args) throws Exception {
    long started = System.currentTimeMillis();
    root = Path.of(args[0]).toAbsolutePath().normalize();
    Map<String, List<String>> groups = new LinkedHashMap<>();
    for (String line : Files.readAllLines(Path.of(args[1]), StandardCharsets.UTF_8)) {
      int tab = line.indexOf('\t');
      if (tab < 0) continue;
      String rel = line.substring(tab + 1);
      groups.computeIfAbsent(line.substring(0, tab), k -> new ArrayList<>()).add(rel);
      listed.add(rel);
    }
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      Files.writeString(Path.of(args[2]), "{\"status\":\"skip\",\"reason\":" + q("JDK のコンパイラーが無い(JRE だけがインストールされている)") + "}", StandardCharsets.UTF_8);
      return;
    }
    // クラスパスとソースパスを空のフォルダーにして、カレントフォルダーの .class や .java を拾わないようにする
    emptyDir = Files.createTempDirectory("codebase-guide-javac");
    try {
      List<String> all = new ArrayList<>();
      groups.values().forEach(all::addAll);
      // まとめて解析すればモジュールをまたぐリンクも付けられる。同じ完全修飾名のクラスが複数あるときだけ、モジュールごとに分ける。
      if (!analyze(compiler, "all", all, true)) {
        notes.add("同じ完全修飾名のクラスが複数のモジュールにあるため、Java はモジュール(pom.xml / build.gradle)ごとに解析した。モジュールをまたぐリンクは付けていない");
        for (Map.Entry<String, List<String>> g : groups.entrySet()) analyze(compiler, g.getKey(), g.getValue(), false);
      }
    } finally {
      Files.deleteIfExists(emptyDir);
    }
    write(Path.of(args[2]), (System.currentTimeMillis() - started) / 1000.0);
  }

  static boolean analyze(JavaCompiler compiler, String label, List<String> rels, boolean allowSplit) throws Exception {
    long t0 = System.currentTimeMillis();
    StandardJavaFileManager fm = compiler.getStandardFileManager(null, Locale.ROOT, StandardCharsets.UTF_8);
    List<Path> paths = rels.stream().map(root::resolve).toList();
    DiagnosticListener<JavaFileObject> listener = d -> { if (d.getKind() == Diagnostic.Kind.ERROR) errorCount++; };
    List<String> options = List.of("-proc:none", "-implicit:none", "-Xlint:none", "-nowarn", "-encoding", "UTF-8",
        "-cp", emptyDir.toString(), "-sourcepath", emptyDir.toString());
    JavacTask task = (JavacTask) compiler.getTask(null, fm, listener, options, null, fm.getJavaFileObjectsFromPaths(paths));
    List<CompilationUnitTree> units = new ArrayList<>();
    task.parse().forEach(units::add);
    Map<String, Integer> count = new HashMap<>();
    for (CompilationUnitTree cu : units) for (String name : topLevelNames(cu)) count.merge(name, 1, Integer::sum);
    Set<String> duplicated = new HashSet<>();
    count.forEach((name, n) -> { if (n > 1) duplicated.add(name); });
    if (!duplicated.isEmpty() && allowSplit) { fm.close(); return false; }
    task.analyze();
    long t1 = System.currentTimeMillis();
    Ctx ctx = new Ctx(task, duplicated);
    int n = 0;
    for (CompilationUnitTree cu : units) {
      String rel = ctx.relOf(cu);
      if (rel == null || files.containsKey(rel)) continue;
      ctx.scanUnit(cu, rel);
      n++;
    }
    fm.close();
    System.out.printf("  javac (%s): %d files (型の解析 %.1fs + 参照 %.1fs)%n", label.equals("all") ? "Java" : label, n, (t1 - t0) / 1000.0, (System.currentTimeMillis() - t1) / 1000.0);
    return true;
  }

  static List<String> topLevelNames(CompilationUnitTree cu) {
    String pkg = cu.getPackageName() == null ? "" : cu.getPackageName().toString();
    List<String> out = new ArrayList<>();
    for (Tree t : cu.getTypeDecls()) if (t instanceof ClassTree ct) out.add(pkg.isEmpty() ? ct.getSimpleName().toString() : pkg + "." + ct.getSimpleName());
    return out;
  }

  static class Src {
    final String content;
    final int[] starts;
    final boolean bom;
    Src(String content) {
      this.content = content;
      this.bom = content.startsWith("﻿");
      List<Integer> s = new ArrayList<>();
      s.add(0);
      for (int i = 0; i < content.length(); i++) {
        char c = content.charAt(i);
        if (c == '\r') { if (i + 1 < content.length() && content.charAt(i + 1) == '\n') i++; s.add(i + 1); }
        else if (c == '\n') s.add(i + 1);
      }
      starts = s.stream().mapToInt(Integer::intValue).toArray();
    }
    // { 1 から数えた行, 行内の位置 }。改行は \r\n・\r・\n を数える(ページの行分けと同じ)。BOM は位置に含めない。
    int[] lineCol(long pos) {
      int lo = 0, hi = starts.length - 1;
      while (lo < hi) { int mid = (lo + hi + 1) >>> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
      int col = (int) (pos - starts[lo]);
      if (lo == 0 && bom) col -= 1;
      return new int[] { lo + 1, col };
    }
  }

  static class Ctx {
    final Trees trees;
    final SourcePositions sp;
    final Elements elements;
    final Types types;
    final Set<String> duplicated;
    final Map<CompilationUnitTree, Src> srcs = new IdentityHashMap<>();
    final Map<TypeElement, Boolean> brokenCache = new HashMap<>();

    Ctx(JavacTask task, Set<String> duplicated) {
      trees = Trees.instance(task);
      sp = trees.getSourcePositions();
      elements = task.getElements();
      types = task.getTypes();
      this.duplicated = duplicated;
    }

    Src src(CompilationUnitTree cu) {
      return srcs.computeIfAbsent(cu, c -> {
        try { return new Src(c.getSourceFile().getCharContent(true).toString()); }
        catch (Exception e) { return new Src(""); }
      });
    }

    String relOf(CompilationUnitTree cu) {
      try {
        String r = root.relativize(Path.of(cu.getSourceFile().toUri()).toAbsolutePath().normalize()).toString().replace('\\', '/');
        return listed.contains(r) ? r : null;
      } catch (Exception e) {
        return null;
      }
    }

    void scanUnit(CompilationUnitTree cu, String rel) {
      Src src = src(cu);
      List<int[]> refs = new ArrayList<>();
      // 同じ完全修飾名のクラスがほかにもあるファイルは、どちらのクラスに解決されたか分からないので、リンク元にもしない
      if (topLevelNames(cu).stream().noneMatch(duplicated::contains)) {
        // 依存が無くて読み込めない import と同じ名前は、同じパッケージの自分のクラスに解決されていることがあるので使わない
        Set<String> failedImports = new HashSet<>();
        for (ImportTree it : cu.getImports()) {
          if (it.isStatic() || !(it.getQualifiedIdentifier() instanceof MemberSelectTree ms) || ms.getIdentifier().contentEquals("*")) continue;
          Element e = trees.getElement(TreePath.getPath(cu, ms));
          if (e == null || e.asType().getKind() == TypeKind.ERROR) failedImports.add(ms.getIdentifier().toString());
        }
        new RefScanner(this, cu, src, refs, failedImports).scan(cu, null);
      }
      refCount += refs.size();
      files.put(rel, new Object[] { hash(src.content), refs });
    }

    // リンク先にする定義。引数・ローカル変数・型引数は含めない。
    // 型が読み込めないフィールド(依存ライブラリの型のフィールドなど)も、フィールド自体の定義はリポジトリ内にあるのでリンクする。
    static boolean linkable(Element e) {
      if (e == null) return false;
      return switch (e.getKind()) {
        case CLASS, INTERFACE, ENUM, RECORD, ANNOTATION_TYPE, METHOD, FIELD, ENUM_CONSTANT, RECORD_COMPONENT -> true;
        default -> false;
      };
    }

    // 親クラス・インターフェースのどこかが読み込めない(依存が無い)型か
    boolean broken(TypeMirror t) {
      if (t == null) return true;
      switch (t.getKind()) {
        case ERROR: return true;
        case DECLARED: return brokenType((TypeElement) types.asElement(t));
        case TYPEVAR: return broken(((TypeVariable) t).getUpperBound());
        case INTERSECTION: return ((IntersectionType) t).getBounds().stream().anyMatch(this::broken);
        default: return false;
      }
    }

    boolean brokenType(TypeElement te) {
      if (te == null) return true;
      Boolean cached = brokenCache.get(te);
      if (cached != null) return cached;
      brokenCache.put(te, false);
      boolean b = brokenSuper(te.getSuperclass());
      for (TypeMirror i : te.getInterfaces()) b = b || brokenSuper(i);
      brokenCache.put(te, b);
      return b;
    }

    boolean brokenSuper(TypeMirror t) {
      return t.getKind() == TypeKind.ERROR || (t.getKind() == TypeKind.DECLARED && brokenType((TypeElement) types.asElement(t)));
    }

    TypeElement asTypeElement(TypeMirror t) {
      if (t == null) return null;
      if (t.getKind() == TypeKind.DECLARED) return (TypeElement) types.asElement(t);
      if (t.getKind() == TypeKind.TYPEVAR) return asTypeElement(((TypeVariable) t).getUpperBound());
      return null;
    }

    static TypeElement topLevel(Element e) {
      Element cur = e;
      while (cur != null && cur.getEnclosingElement() != null && cur.getEnclosingElement().getKind() != ElementKind.PACKAGE && cur.getEnclosingElement().getKind() != ElementKind.MODULE) cur = cur.getEnclosingElement();
      return cur instanceof TypeElement te ? te : null;
    }

    // 定義の名前の位置(注釈や修飾子の後ろ)。見つからなければ宣言の先頭。
    long namePos(CompilationUnitTree cu, Tree leaf, Element e) {
      String name = (e.getKind() == ElementKind.CONSTRUCTOR ? e.getEnclosingElement().getSimpleName() : e.getSimpleName()).toString();
      long start = sp.getStartPosition(cu, leaf);
      long end = sp.getEndPosition(cu, leaf);
      long from = start;
      if (leaf instanceof ClassTree ct) from = Math.max(from, sp.getEndPosition(cu, ct.getModifiers()));
      else if (leaf instanceof MethodTree mt) from = Math.max(from, mt.getReturnType() != null ? sp.getEndPosition(cu, mt.getReturnType()) : sp.getEndPosition(cu, mt.getModifiers()));
      else if (leaf instanceof VariableTree vt) from = Math.max(from, Math.max(sp.getEndPosition(cu, vt.getModifiers()), vt.getType() != null ? sp.getEndPosition(cu, vt.getType()) : -1));
      String content = src(cu).content;
      if (end < 0 || end > content.length()) end = content.length();
      for (int i = content.indexOf(name, (int) Math.max(0, from)); i >= 0 && i + name.length() <= end; i = content.indexOf(name, i + 1)) {
        boolean before = i == 0 || !Character.isJavaIdentifierPart(content.charAt(i - 1));
        boolean after = i + name.length() >= content.length() || !Character.isJavaIdentifierPart(content.charAt(i + name.length()));
        if (before && after) return i;
      }
      return start;
    }

    // 定義の木を探す処理(Trees.getPath)はファイル全体をたどるので、定義ごとに結果を覚えておく
    final Map<Element, Integer> targetCache = new HashMap<>();

    Integer target(Element e) {
      if (!linkable(e)) return null;
      if (targetCache.containsKey(e)) return targetCache.get(e);
      Integer id = findTarget(e);
      targetCache.put(e, id);
      return id;
    }

    Integer findTarget(Element e) {
      TreePath decl = trees.getPath(e);
      if (decl == null && e.getKind() == ElementKind.METHOD && e.getEnclosingElement().getKind() == ElementKind.RECORD) {
        // レコードの暗黙のアクセサーは、レコードの成分の宣言へ
        TypeElement record = (TypeElement) e.getEnclosingElement();
        for (RecordComponentElement rc : record.getRecordComponents()) {
          if (!e.equals(rc.getAccessor())) continue;
          decl = trees.getPath(rc);
          // 成分そのものの位置が取れない場合は、成分から作られるフィールド(位置はレコードの見出しの成分)を使う
          if (decl == null) for (VariableElement f : ElementFilter.fieldsIn(record.getEnclosedElements())) if (f.getSimpleName().equals(rc.getSimpleName())) decl = trees.getPath(f);
        }
      }
      if (decl == null) return null;
      CompilationUnitTree dcu = decl.getCompilationUnit();
      String rel = relOf(dcu);
      if (rel == null) return null;
      TypeElement top = topLevel(e);
      if (top != null && duplicated.contains(top.getQualifiedName().toString())) return null;
      int line = src(dcu).lineCol(namePos(dcu, decl.getLeaf(), e))[0];
      String key = rel + ":" + line;
      Integer id = targetIndex.get(key);
      if (id == null) { id = targets.size(); targets.add(new Object[] { rel, line }); targetIndex.put(key, id); }
      return id;
    }
  }

  static class RefScanner extends TreePathScanner<Void, Void> {
    final Ctx ctx;
    final CompilationUnitTree cu;
    final Src src;
    final List<int[]> refs;
    final Set<String> failedImports;
    final Set<Tree> handled = Collections.newSetFromMap(new IdentityHashMap<>());

    RefScanner(Ctx ctx, CompilationUnitTree cu, Src src, List<int[]> refs, Set<String> failedImports) {
      this.ctx = ctx; this.cu = cu; this.src = src; this.refs = refs; this.failedImports = failedImports;
    }

    // 内側から見て、本体(メンバー)の中にいるクラス。anyBroken は、そのどれかの親が読み込めないか。
    record Enclosing(TypeElement inner, boolean anyBroken) {}

    Enclosing enclosing(TreePath path) {
      TypeElement inner = null;
      boolean anyBroken = false;
      Tree child = path.getLeaf();
      for (TreePath p = path.getParentPath(); p != null; child = p.getLeaf(), p = p.getParentPath()) {
        if (!(p.getLeaf() instanceof ClassTree ct)) continue;
        Tree c = child;
        if (ct.getMembers().stream().noneMatch(m -> m == c)) continue;
        Element e = ctx.trees.getElement(p);
        if (!(e instanceof TypeElement te)) continue;
        if (inner == null) inner = te;
        anyBroken = anyBroken || ctx.brokenType(te);
      }
      return new Enclosing(inner, anyBroken);
    }

    static boolean nestedIn(Element e, TypeElement outer) {
      for (Element cur = e; cur != null; cur = cur.getEnclosingElement()) if (cur.equals(outer)) return true;
      return false;
    }

    void emit(long start, String name, List<? extends Element> elems) {
      if (start < 0 || !src.content.startsWith(name, (int) start)) return;
      List<Integer> ids = new ArrayList<>();
      for (Element e : elems) {
        Integer id = ctx.target(e);
        if (id == null) return; // 候補の一部でもリポジトリ外にあれば、どれが正しいか示せないので付けない
        if (!ids.contains(id)) ids.add(id);
      }
      if (ids.isEmpty()) return;
      int[] lc = src.lineCol(start);
      int[] ref = new int[3 + ids.size()];
      ref[0] = lc[0]; ref[1] = lc[1]; ref[2] = name.length();
      for (int i = 0; i < ids.size(); i++) ref[3 + i] = ids.get(i);
      refs.add(ref);
    }

    long nameStart(Tree t, String name) {
      if (t instanceof IdentifierTree) return ctx.sp.getStartPosition(cu, t);
      long end = ctx.sp.getEndPosition(cu, t);
      return end < 0 ? -1 : end - name.length();
    }

    @Override public Void visitIdentifier(IdentifierTree t, Void v) {
      if (!handled.contains(t)) linkName(t, t.getName().toString(), true);
      return super.visitIdentifier(t, v);
    }

    @Override public Void visitMemberSelect(MemberSelectTree t, Void v) {
      if (!handled.contains(t)) linkName(t, t.getIdentifier().toString(), false);
      return super.visitMemberSelect(t, v);
    }

    void linkName(Tree t, String name, boolean unqualified) {
      if (name.equals("this") || name.equals("super") || name.equals("class")) return;
      Element e = ctx.trees.getElement(getCurrentPath());
      if (!Ctx.linkable(e)) return;
      if (unqualified) {
        if (e instanceof TypeElement && failedImports.contains(name)) return;
        Enclosing enc = enclosing(getCurrentPath());
        // 親が読み込めないクラスの中では、その親から受け継ぐ同じ名前のメンバーや型が隠れているかもしれない。
        // そのクラス自身の中で定義されたものだけをリンクする。
        if (enc.anyBroken()) {
          if (e instanceof TypeElement te ? !nestedIn(te, enc.inner()) : !e.getEnclosingElement().equals(enc.inner())) return;
        }
      }
      emit(nameStart(t, name), name, List.of(e));
    }

    @Override public Void visitMethodInvocation(MethodInvocationTree t, Void v) {
      ExpressionTree sel = t.getMethodSelect();
      handled.add(sel);
      TreePath selPath = new TreePath(getCurrentPath(), sel);
      if (ctx.trees.getElement(selPath) instanceof ExecutableElement m && m.getKind() == ElementKind.METHOD) linkMethod(sel, selPath, m, t.getArguments());
      return super.visitMethodInvocation(t, v);
    }

    void linkMethod(ExpressionTree sel, TreePath selPath, ExecutableElement m, List<? extends ExpressionTree> args) {
      String name = m.getSimpleName().toString();
      TypeElement owner;
      boolean brokenRecv;
      if (sel instanceof MemberSelectTree ms) {
        TypeMirror rt = ctx.trees.getTypeMirror(new TreePath(selPath, ms.getExpression()));
        if (rt == null || rt.getKind() == TypeKind.ERROR) return;
        brokenRecv = ctx.broken(rt);
        owner = ctx.asTypeElement(rt);
      } else {
        Enclosing enc = enclosing(getCurrentPath());
        if (enc.inner() == null) return;
        if (enc.anyBroken() && !m.getEnclosingElement().equals(enc.inner())) return;
        brokenRecv = ctx.brokenType(enc.inner());
        owner = (TypeElement) m.getEnclosingElement();
      }
      List<TypeMirror> argTypes = new ArrayList<>();
      for (ExpressionTree a : args) argTypes.add(ctx.trees.getTypeMirror(new TreePath(getCurrentPath(), a)));
      boolean argError = argTypes.stream().anyMatch(a -> a == null || a.getKind() == TypeKind.ERROR);
      long start = nameStart(sel, name);
      if (brokenRecv) {
        // 読み込めない親に、より合うオーバーロードが隠れているかもしれない。引数の型が引数宣言と完全に同じ呼び出しだけリンクする。
        if (argError || m.isVarArgs() || !sameTypes(argTypes, m)) return;
        emit(start, name, List.of(m));
        return;
      }
      if (argError) {
        // 引数の型が分からないと、どのオーバーロードが呼ばれるか決められない。引数の数が合うものをすべて候補にする。
        if (owner == null) return;
        List<ExecutableElement> candidates = new ArrayList<>();
        for (Element member : ctx.elements.getAllMembers(owner)) {
          if (member instanceof ExecutableElement x && x.getKind() == ElementKind.METHOD && x.getSimpleName().contentEquals(name)) {
            int params = x.getParameters().size();
            if (params == args.size() || (x.isVarArgs() && args.size() >= params - 1)) candidates.add(x);
          }
        }
        if (!candidates.isEmpty()) emit(start, name, candidates);
        return;
      }
      emit(start, name, List.of(m));
    }

    boolean sameTypes(List<TypeMirror> argTypes, ExecutableElement m) {
      List<? extends VariableElement> params = m.getParameters();
      if (params.size() != argTypes.size()) return false;
      for (int i = 0; i < params.size(); i++) {
        if (!ctx.types.isSameType(ctx.types.erasure(argTypes.get(i)), ctx.types.erasure(params.get(i).asType()))) return false;
      }
      return true;
    }

    @Override public Void visitMemberReference(MemberReferenceTree t, Void v) {
      String name = t.getName().toString();
      if (!name.equals("<init>") && ctx.trees.getElement(getCurrentPath()) instanceof ExecutableElement m && m.getKind() == ElementKind.METHOD) {
        TypeMirror recv = ctx.trees.getTypeMirror(new TreePath(getCurrentPath(), t.getQualifierExpression()));
        TypeMirror fn = ctx.trees.getTypeMirror(getCurrentPath());
        // 関数型(代入先)が分からないと、オーバーロードを選べない
        if (recv != null && recv.getKind() != TypeKind.ERROR && !ctx.broken(recv) && fn != null && fn.getKind() != TypeKind.ERROR) {
          emit(nameStart(t, name), name, List.of(m));
        }
      }
      return super.visitMemberReference(t, v);
    }
  }

  // xref.mjs の sourceHash(normalizeSource(本文)) と同じ値(BOM と改行コードの違いを無視した本文の SHA-1 の先頭16桁)
  static String hash(String content) {
    String normalized = content.replaceFirst("^﻿", "").replace("\r\n", "\n").replace('\r', '\n');
    byte[] digest;
    try { digest = MessageDigest.getInstance("SHA-1").digest(normalized.getBytes(StandardCharsets.UTF_8)); }
    catch (Exception e) { throw new IllegalStateException(e); }
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 8; i++) sb.append(String.format("%02x", digest[i]));
    return sb.toString();
  }

  static String q(String s) {
    StringBuilder sb = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"' -> sb.append("\\\"");
        case '\\' -> sb.append("\\\\");
        case '\n' -> sb.append("\\n");
        case '\r' -> sb.append("\\r");
        case '\t' -> sb.append("\\t");
        default -> { if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c); }
      }
    }
    return sb.append('"').toString();
  }

  static void write(Path out, double seconds) throws Exception {
    StringBuilder sb = new StringBuilder();
    sb.append("{\"status\":\"ok\",\"engine\":").append(q("javac " + System.getProperty("java.version"))).append(",\"files\":{");
    boolean first = true;
    for (Map.Entry<String, Object[]> f : files.entrySet()) {
      if (!first) sb.append(',');
      first = false;
      sb.append(q(f.getKey())).append(":{\"hash\":").append(q((String) f.getValue()[0])).append(",\"refs\":[");
      @SuppressWarnings("unchecked") List<int[]> refs = (List<int[]>) f.getValue()[1];
      for (int i = 0; i < refs.size(); i++) {
        int[] r = refs.get(i);
        if (i > 0) sb.append(',');
        sb.append('[').append(r[0]).append(',').append(r[1]).append(',').append(r[2]).append(',');
        if (r.length == 4) sb.append(r[3]);
        else {
          sb.append('[');
          for (int j = 3; j < r.length; j++) { if (j > 3) sb.append(','); sb.append(r[j]); }
          sb.append(']');
        }
        sb.append(']');
      }
      sb.append("]}");
    }
    sb.append("},\"targets\":[");
    for (int i = 0; i < targets.size(); i++) {
      if (i > 0) sb.append(',');
      sb.append('[').append(q((String) targets.get(i)[0])).append(',').append(targets.get(i)[1]).append(']');
    }
    sb.append("],\"stats\":{\"files\":").append(files.size()).append(",\"refs\":").append(refCount).append(",\"targets\":").append(targets.size())
      .append(",\"errors\":").append(errorCount).append(",\"seconds\":").append(seconds).append("},\"notes\":[");
    for (int i = 0; i < notes.size(); i++) { if (i > 0) sb.append(','); sb.append(q(notes.get(i))); }
    sb.append("]}");
    Files.writeString(out, sb, StandardCharsets.UTF_8);
  }
}
