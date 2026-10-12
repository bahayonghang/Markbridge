"""Create one disposable Spartan favorites database and read it back.

The file is an ESE database named by the caller. Titles and URLs stay in the
file; this script prints only counts, column types, and JET status codes.
"""
import ctypes
import sys
import uuid
from pathlib import Path

JET_ERR = ctypes.c_long
JET_API_PTR = ctypes.c_uint64
JET_INSTANCE = JET_API_PTR
JET_SESID = JET_API_PTR
JET_TABLEID = JET_API_PTR
JET_DBID = ctypes.c_ulong
JET_COLUMNID = ctypes.c_ulong
JET_COLTYP = ctypes.c_ulong
JET_GRBIT = ctypes.c_ulong

JET_paramRecovery = 34
JET_paramDatabasePageSize = 64
JET_paramSystemPath = 0
JET_paramTempPath = 1
JET_paramLogFilePath = 2
JET_sesidNil = JET_SESID(0xFFFFFFFFFFFFFFFF)
JET_bitDbRecoveryOff = 0x8
JET_bitDbReadOnly = 0x1
JET_bitColumnFixed = 0x1
JET_bitColumnTagged = 0x2
JET_coltypBit = 1
JET_coltypLongText = 12
JET_coltypLongLong = 15
JET_coltypGUID = 16
JET_prepInsert = 0
JET_ColInfoBase = 4
JET_MoveFirst = 0x80000000
JET_errSuccess = 0
JET_wrnColumnNull = 1004
JET_unicodeCp = 1200
PAGE_SIZE = 8192


class COLUMNDEF(ctypes.Structure):
    _fields_ = [
        ("cbStruct", ctypes.c_ulong),
        ("columnid", JET_COLUMNID),
        ("coltyp", JET_COLTYP),
        ("wCountry", ctypes.c_ushort),
        ("langid", ctypes.c_ushort),
        ("cp", ctypes.c_ushort),
        ("wCollate", ctypes.c_ushort),
        ("cbMax", ctypes.c_ulong),
        ("grbit", JET_GRBIT),
    ]


class COLUMNBASE(ctypes.Structure):
    _fields_ = [
        ("cbStruct", ctypes.c_ulong),
        ("columnid", JET_COLUMNID),
        ("coltyp", JET_COLTYP),
        ("wCountry", ctypes.c_ushort),
        ("langid", ctypes.c_ushort),
        ("cp", ctypes.c_ushort),
        ("wFiller", ctypes.c_ushort),
        ("cbMax", ctypes.c_ulong),
        ("grbit", JET_GRBIT),
        ("szBaseTableName", ctypes.c_wchar * 256),
        ("szBaseColumnName", ctypes.c_wchar * 256),
    ]


esent = ctypes.WinDLL("esent.dll")
esent.JetSetSystemParameterW.argtypes = [
    ctypes.POINTER(JET_INSTANCE), JET_SESID, ctypes.c_ulong, JET_API_PTR, ctypes.c_wchar_p,
]
esent.JetSetSystemParameterW.restype = JET_ERR
esent.JetCreateInstanceW.argtypes = [ctypes.POINTER(JET_INSTANCE), ctypes.c_wchar_p]
esent.JetCreateInstanceW.restype = JET_ERR
esent.JetInit.argtypes = [ctypes.POINTER(JET_INSTANCE)]
esent.JetInit.restype = JET_ERR
esent.JetTerm.argtypes = [JET_INSTANCE]
esent.JetTerm.restype = JET_ERR
esent.JetBeginSessionW.argtypes = [JET_INSTANCE, ctypes.POINTER(JET_SESID), ctypes.c_wchar_p, ctypes.c_wchar_p]
esent.JetBeginSessionW.restype = JET_ERR
esent.JetEndSession.argtypes = [JET_SESID, JET_GRBIT]
esent.JetEndSession.restype = JET_ERR
esent.JetCreateDatabaseW.argtypes = [JET_SESID, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.POINTER(JET_DBID), JET_GRBIT]
esent.JetCreateDatabaseW.restype = JET_ERR
esent.JetAttachDatabase2W.argtypes = [JET_SESID, ctypes.c_wchar_p, ctypes.c_ulong, JET_GRBIT]
esent.JetAttachDatabase2W.restype = JET_ERR
esent.JetOpenDatabaseW.argtypes = [JET_SESID, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.POINTER(JET_DBID), JET_GRBIT]
esent.JetOpenDatabaseW.restype = JET_ERR
esent.JetCloseDatabase.argtypes = [JET_SESID, JET_DBID, JET_GRBIT]
esent.JetCloseDatabase.restype = JET_ERR
esent.JetBeginTransaction.argtypes = [JET_SESID]
esent.JetBeginTransaction.restype = JET_ERR
esent.JetCommitTransaction.argtypes = [JET_SESID, JET_GRBIT]
esent.JetCommitTransaction.restype = JET_ERR
esent.JetCreateTableW.argtypes = [JET_SESID, JET_DBID, ctypes.c_wchar_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.POINTER(JET_TABLEID)]
esent.JetCreateTableW.restype = JET_ERR
esent.JetCloseTable.argtypes = [JET_SESID, JET_TABLEID]
esent.JetCloseTable.restype = JET_ERR
esent.JetAddColumnW.argtypes = [JET_SESID, JET_TABLEID, ctypes.c_wchar_p, ctypes.POINTER(COLUMNDEF), ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(JET_COLUMNID)]
esent.JetAddColumnW.restype = JET_ERR
esent.JetPrepareUpdate.argtypes = [JET_SESID, JET_TABLEID, ctypes.c_ulong]
esent.JetPrepareUpdate.restype = JET_ERR
esent.JetSetColumn.argtypes = [JET_SESID, JET_TABLEID, JET_COLUMNID, ctypes.c_void_p, ctypes.c_ulong, JET_GRBIT, ctypes.c_void_p]
esent.JetSetColumn.restype = JET_ERR
esent.JetUpdate.argtypes = [JET_SESID, JET_TABLEID, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
esent.JetUpdate.restype = JET_ERR
esent.JetOpenTableW.argtypes = [JET_SESID, JET_DBID, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_ulong, JET_GRBIT, ctypes.POINTER(JET_TABLEID)]
esent.JetOpenTableW.restype = JET_ERR
esent.JetMove.argtypes = [JET_SESID, JET_TABLEID, ctypes.c_long, JET_GRBIT]
esent.JetMove.restype = JET_ERR
esent.JetGetTableColumnInfoW.argtypes = [JET_SESID, JET_TABLEID, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong]
esent.JetGetTableColumnInfoW.restype = JET_ERR
esent.JetRetrieveColumn.argtypes = [JET_SESID, JET_TABLEID, JET_COLUMNID, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), JET_GRBIT, ctypes.c_void_p]
esent.JetRetrieveColumn.restype = JET_ERR


def check(step, err):
    if err != JET_errSuccess and err != JET_wrnColumnNull:
        raise SystemExit(f"{step} {int(err)}")


def column(coltyp, cb_max, grbit, cp=0):
    info = COLUMNDEF()
    info.cbStruct = ctypes.sizeof(COLUMNDEF)
    info.coltyp = coltyp
    info.cbMax = cb_max
    info.grbit = grbit
    info.cp = cp
    return info


def set_param(instance, param, number, text):
    target = None if instance is None else ctypes.byref(instance)
    check("SET_PARAM", esent.JetSetSystemParameterW(target, JET_sesidNil, param, number, text))


def open_instance(name, folder):
    instance = JET_INSTANCE(0)
    check("CREATE_INSTANCE", esent.JetCreateInstanceW(ctypes.byref(instance), name))
    set_param(instance, JET_paramSystemPath, 0, str(folder))
    set_param(instance, JET_paramTempPath, 0, str(folder))
    set_param(instance, JET_paramLogFilePath, 0, str(folder))
    set_param(instance, JET_paramRecovery, 0, "off")
    check("INIT", esent.JetInit(ctypes.byref(instance)))
    session = JET_SESID(0)
    check("BEGIN_SESSION", esent.JetBeginSessionW(instance, ctypes.byref(session), None, None))
    return instance, session


def close_instance(instance, session, dbid=None, table=None):
    if table is not None and table.value:
        esent.JetCloseTable(session, table)
    if dbid is not None:
        esent.JetCloseDatabase(session, dbid, 0)
    if session.value:
        esent.JetEndSession(session, 0)
    if instance.value:
        esent.JetTerm(instance)


def create_database(path):
    folder = path.parent
    folder.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise SystemExit("SEED_EXISTS")
    set_param(None, JET_paramDatabasePageSize, PAGE_SIZE, None)
    instance, session = open_instance("Mb03EdgeSeed", folder)
    dbid = JET_DBID(0)
    table = JET_TABLEID(0)
    try:
        check("CREATE_DB", esent.JetCreateDatabaseW(session, str(path), None, ctypes.byref(dbid), JET_bitDbRecoveryOff))
        check("BEGIN_TX", esent.JetBeginTransaction(session))
        check("CREATE_TABLE", esent.JetCreateTableW(session, dbid, "Favorites", 20, 90, ctypes.byref(table)))
        specs = {
            "IsDeleted": column(JET_coltypBit, 1, JET_bitColumnFixed),
            "IsFolder": column(JET_coltypBit, 1, JET_bitColumnFixed),
            "URL": column(JET_coltypLongText, 2048, JET_bitColumnTagged, JET_unicodeCp),
            "Title": column(JET_coltypLongText, 2048, JET_bitColumnTagged, JET_unicodeCp),
            "FaviconFile": column(JET_coltypLongText, 2048, JET_bitColumnTagged, JET_unicodeCp),
            "ParentId": column(JET_coltypGUID, 16, JET_bitColumnFixed),
            "ItemId": column(JET_coltypGUID, 16, JET_bitColumnFixed),
            "OrderNumber": column(JET_coltypLongLong, 8, JET_bitColumnFixed),
            "DateUpdated": column(JET_coltypLongLong, 8, JET_bitColumnFixed),
        }
        ids = {}
        for name, spec in specs.items():
            column_id = JET_COLUMNID(0)
            check(f"ADD_{name}", esent.JetAddColumnW(session, table, name, ctypes.byref(spec), None, 0, ctypes.byref(column_id)))
            ids[name] = column_id
        check("PREPARE", esent.JetPrepareUpdate(session, table, JET_prepInsert))

        def put(name, blob):
            buf = ctypes.create_string_buffer(blob)
            check(f"SET_{name}", esent.JetSetColumn(session, table, ids[name], buf, len(blob), 0, None))

        put("IsDeleted", bytes([0]))
        put("IsFolder", bytes([0]))
        put("URL", "https://example.com/mb03".encode("utf-16le") + b"\x00\x00")
        put("Title", "mb03".encode("utf-16le") + b"\x00\x00")
        put("ParentId", bytes(16))
        put("ItemId", uuid.UUID("11111111-2222-3333-4444-555555555555").bytes_le)
        put("OrderNumber", (0).to_bytes(8, "little"))
        put("DateUpdated", (134000000000000000).to_bytes(8, "little"))
        check("UPDATE", esent.JetUpdate(session, table, None, 0, None))
        check("COMMIT", esent.JetCommitTransaction(session, 0))
    finally:
        close_instance(instance, session, dbid if dbid.value else None, table if table.value else None)


def verify_database(path):
    folder = path.parent
    set_param(None, JET_paramDatabasePageSize, PAGE_SIZE, None)
    instance, session = open_instance("EdgeDataImporter", folder)
    dbid = JET_DBID(0)
    table = JET_TABLEID(0)
    try:
        check("ATTACH", esent.JetAttachDatabase2W(session, str(path), 0, JET_bitDbReadOnly))
        check("OPEN_DB", esent.JetOpenDatabaseW(session, str(path), None, ctypes.byref(dbid), JET_bitDbReadOnly))
        check("OPEN_TABLE", esent.JetOpenTableW(session, dbid, "Favorites", None, 0, JET_bitDbReadOnly, ctypes.byref(table)))
        info = {}
        for name in ("URL", "Title", "IsFolder", "ItemId", "DateUpdated"):
            base = COLUMNBASE()
            base.cbStruct = ctypes.sizeof(COLUMNBASE)
            check(f"INFO_{name}", esent.JetGetTableColumnInfoW(session, table, name, ctypes.byref(base), ctypes.sizeof(base), JET_ColInfoBase))
            info[name] = (int(base.coltyp), int(base.cp), int(base.cbMax))
        check("MOVE", esent.JetMove(session, table, JET_MoveFirst, 0))
        url_base = COLUMNBASE()
        url_base.cbStruct = ctypes.sizeof(COLUMNBASE)
        check("INFO_URL2", esent.JetGetTableColumnInfoW(session, table, "URL", ctypes.byref(url_base), ctypes.sizeof(url_base), JET_ColInfoBase))
        actual = ctypes.c_ulong(0)
        buf = ctypes.create_string_buffer(url_base.cbMax or 8)
        err = esent.JetRetrieveColumn(session, table, url_base.columnid, buf, len(buf), ctypes.byref(actual), 0, None)
        check("READ_URL", err)
        if info["URL"][0] != JET_coltypLongText or info["URL"][1] != JET_unicodeCp or info["URL"][2] == 0:
            raise SystemExit(f"URL_COLUMN {info['URL']}")
        if info["Title"][0] != JET_coltypLongText or actual.value < 2:
            raise SystemExit("TITLE_COLUMN")
        print(f"rows=1 urlCp={info['URL'][1]} urlCb={info['URL'][2]} titleCb={info['Title'][2]}", flush=True)
    finally:
        close_instance(instance, session, dbid if dbid.value else None, table if table.value else None)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("SEED_ARGS")
    if ctypes.sizeof(COLUMNDEF) != 28:
        raise SystemExit(f"COLUMNDEF_SIZE {ctypes.sizeof(COLUMNDEF)}")
    path = Path(sys.argv[1])
    create_database(path)
    verify_database(path)


if __name__ == "__main__":
    main()
