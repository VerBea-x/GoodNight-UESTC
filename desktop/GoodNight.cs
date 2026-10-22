using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class GoodNight
{
    private const string TaskName = "io.github.beichenO2.goodnight";
    private const string Url = "http://127.0.0.1:3210/";

    [STAThread]
    private static void Main()
    {
        try { Run(); }
        catch (Exception error)
        {
            MessageBox.Show("启动失败：" + error.Message + "\n\n可在“%LOCALAPPDATA%\\GoodNight”查看后台日志。", "晚安成电", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void Run()
    {
        string source = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "GoodNight");
        string entry = Path.Combine(source, "bin", "goodnight.mjs");
        if (!File.Exists(entry)) throw new Exception("应用文件不完整，请重新解压完整安装包。");
        if (!String.Equals(Path.GetFullPath(source), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
        {
            CopyApplication(source, target);
            string node = LocateNode(source);
            string installedNode = Path.Combine(target, "runtime", "node.exe");
            Directory.CreateDirectory(Path.GetDirectoryName(installedNode));
            File.Copy(node, installedNode, true);
            Process.Start(new ProcessStartInfo(Path.Combine(target, "GoodNight.exe")) { UseShellExecute = true });
            return;
        }

        string bundledNode = Path.Combine(target, "runtime", "node.exe");
        if (!File.Exists(bundledNode)) throw new Exception("缺少 Node.js 运行环境，请重新运行安装包。");
        // Re-register the user task when this app is launched. This repairs stale task paths after upgrades.
        if (!IsOursOnline())
        {
            RunHidden(bundledNode, "\"" + Path.Combine(target, "bin", "goodnight.mjs") + "\" service install --web", target, 45000);
            for (int i = 0; i < 30 && !IsOursOnline(); i++) Thread.Sleep(500);
            if (!IsOursOnline()) throw new Exception("后台未能启动。请检查 %LOCALAPPDATA%\\GoodNight\\" + TaskName + ".log，或检查 3210 端口是否被占用。");
        }
        CreateStartMenuShortcut(target);
        string edge = FindEdge();
        if (edge != null) Process.Start(new ProcessStartInfo(edge, "--app=" + Url) { UseShellExecute = true });
        else Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
    }

    private static void CopyApplication(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (string folder in new[] { "bin", "src", "web", "node_modules" })
        {
            string from = Path.Combine(source, folder);
            if (!Directory.Exists(from)) throw new Exception("缺少 " + folder + "，请重新解压完整安装包。");
            CopyDirectory(from, Path.Combine(target, folder));
        }
        foreach (string file in new[] { "GoodNight.exe", "package.json", "LICENSE", "DISCLAIMER.md" })
        {
            string from = Path.Combine(source, file);
            if (File.Exists(from)) File.Copy(from, Path.Combine(target, file), true);
        }
    }

    private static void CopyDirectory(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (string file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true);
        foreach (string directory in Directory.GetDirectories(source)) CopyDirectory(directory, Path.Combine(target, Path.GetFileName(directory)));
    }

    private static string LocateNode(string source)
    {
        string packaged = Path.Combine(source, "runtime", "node.exe");
        if (File.Exists(packaged)) return packaged;
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string folder in path.Split(';'))
        {
            if (String.IsNullOrWhiteSpace(folder)) continue;
            string candidate = Path.Combine(folder.Trim('"'), "node.exe");
            if (File.Exists(candidate))
            {
                try
                {
                    string version = RunHidden(candidate, "--version", source, 5000).TrimStart('v');
                    int major;
                    if (Int32.TryParse(version.Split('.')[0], out major) && major >= 22) return candidate;
                }
                catch { }
            }
        }
        throw new Exception("请先安装 Node.js 22 或更新版本，再双击 GoodNight.exe。");
    }

    private static string RunHidden(string file, string arguments, string directory, int timeout)
    {
        using (Process process = new Process())
        {
            process.StartInfo = new ProcessStartInfo(file, arguments) { WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            process.Start();
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            if (!process.WaitForExit(timeout)) { process.Kill(); throw new Exception("后台启动超时。"); }
            if (process.ExitCode != 0) throw new Exception(String.IsNullOrWhiteSpace(error) ? output.Trim() : error.Trim());
            return output.Trim();
        }
    }

    private static bool IsOursOnline()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Url);
            request.Timeout = 1200;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("晚安成电 · 本机工作台");
        }
        catch { return false; }
    }

    private static string FindEdge()
    {
        foreach (string root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
        {
            string file = Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(file)) return file;
        }
        return null;
    }

    private static void CreateStartMenuShortcut(string target)
    {
        try
        {
            string programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string shortcut = Path.Combine(programs, "晚安成电.lnk");
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcut });
            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { Path.Combine(target, "GoodNight.exe") });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { target });
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "晚安成电签到计划" });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        }
        catch { /* A shortcut is convenient; the installed executable remains usable without it. */ }
    }
}
