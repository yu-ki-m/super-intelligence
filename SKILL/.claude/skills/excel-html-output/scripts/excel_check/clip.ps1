# Raw Windows clipboard access (bytes), independent of .NET encoding quirks.
if (-not ('RawClip' -as [type])) {
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text; using System.Threading;
public static class RawClip {
  [DllImport("user32.dll", SetLastError=true)] static extern bool OpenClipboard(IntPtr h);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string f);
  [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint f);
  [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint f, IntPtr h);
  [DllImport("user32.dll")] static extern uint EnumClipboardFormats(uint f);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClipboardFormatName(uint f, StringBuilder b, int n);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr h);
  [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
  static void Open(){ for(int i=0;i<100;i++){ if(OpenClipboard(IntPtr.Zero)) return; Thread.Sleep(50);} throw new Exception("OpenClipboard failed"); }
  static uint Fmt(string name){ return name=="UnicodeText" ? 13u : RegisterClipboardFormat(name); }
  public static string Formats(){ Open(); try{ var sb=new StringBuilder(); uint f=0; while((f=EnumClipboardFormats(f))!=0){ var n=new StringBuilder(256); GetClipboardFormatName(f,n,256); sb.Append(f).Append(' ').Append(n.ToString()).Append('\n'); } return sb.ToString(); } finally{ CloseClipboard(); } }
  public static byte[] Get(string name){ Open(); try{ IntPtr h=GetClipboardData(Fmt(name)); if(h==IntPtr.Zero) return null; IntPtr p=GlobalLock(h); int n=(int)GlobalSize(h); byte[] b=new byte[n]; Marshal.Copy(p,b,0,n); GlobalUnlock(h); return b; } finally{ CloseClipboard(); } }
  public static string GetHtml(){ var b=Get("HTML Format"); if(b==null) return null; int n=Array.IndexOf(b,(byte)0); return Encoding.UTF8.GetString(b,0,n<0?b.Length:n); }
  public static string GetText(){ var b=Get("UnicodeText"); if(b==null) return null; var s=Encoding.Unicode.GetString(b); int z=s.IndexOf('\0'); return z<0?s:s.Substring(0,z); }
  // html: full document containing <!--StartFragment--> and <!--EndFragment-->
  public static void SetHtml(string html, string text){
    const string hdr="Version:0.9\r\nStartHTML:{0:D10}\r\nEndHTML:{1:D10}\r\nStartFragment:{2:D10}\r\nEndFragment:{3:D10}\r\n";
    int hlen=Encoding.UTF8.GetByteCount(string.Format(hdr,0,0,0,0));
    byte[] body=Encoding.UTF8.GetBytes(html);
    int sf=IndexOf(body,Encoding.UTF8.GetBytes("<!--StartFragment-->")); int ef=IndexOf(body,Encoding.UTF8.GetBytes("<!--EndFragment-->"));
    if(sf<0||ef<0) throw new Exception("fragment markers missing");
    string head=string.Format(hdr,hlen,hlen+body.Length,hlen+sf+20,hlen+ef);
    byte[] all=new byte[hlen+body.Length]; Encoding.UTF8.GetBytes(head,0,head.Length,all,0); Buffer.BlockCopy(body,0,all,hlen,body.Length);
    Open(); try{ EmptyClipboard(); Put(Fmt("HTML Format"),all,1); if(text!=null) Put(13,Encoding.Unicode.GetBytes(text),2); } finally{ CloseClipboard(); }
  }
  public static void SetRaw(byte[] cfhtml, string text){
    int n=Array.IndexOf(cfhtml,(byte)0); if(n>=0){ var t=new byte[n]; Buffer.BlockCopy(cfhtml,0,t,0,n); cfhtml=t; }
    Open(); try{ EmptyClipboard(); Put(Fmt("HTML Format"),cfhtml,1); if(text!=null) Put(13,Encoding.Unicode.GetBytes(text),2); } finally{ CloseClipboard(); }
  }
  static int IndexOf(byte[] a, byte[] p){ for(int i=0;i<=a.Length-p.Length;i++){ int j=0; while(j<p.Length&&a[i+j]==p[j]) j++; if(j==p.Length) return i; } return -1; }
  static void Put(uint f, byte[] b, int nulls){ IntPtr h=GlobalAlloc(0x0002,(UIntPtr)(b.Length+nulls)); IntPtr p=GlobalLock(h); Marshal.Copy(b,0,p,b.Length); for(int i=0;i<nulls;i++) Marshal.WriteByte(p,b.Length+i,0); GlobalUnlock(h); SetClipboardData(f,h); }
}
'@
}
